import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { resetAll, createApp, Sessions, db, disconnect, auth, config } from './helpers.js';

const app = createApp({ sessions: Sessions });
vi.spyOn(Sessions, 'launch').mockImplementation(() => undefined);

afterAll(() => disconnect());
beforeEach(resetAll);

async function setupAdmin() {
    const agent = request.agent(app);
    const res = await agent
        .post('/api/v1/auth/setup')
        .send({ email: 'Admin@Exemplo.com', name: 'Admin', password: 'senha-forte-1' });
    expect(res.status).toBe(201);
    return agent;
}

async function createUser(admin, body) {
    const res = await admin.post('/api/v1/users').send(body);
    expect(res.status).toBe(201);
    const agent = request.agent(app);
    expect((await agent.post('/api/v1/auth/login').send({ email: body.email, password: body.password })).status).toBe(
        200
    );
    return { agent, user: res.body.data };
}

describe('senha', () => {
    it('scrypt com salt; verificação', async () => {
        const hash = await auth.hashPassword('abc12345');
        expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/);
        expect(hash).not.toBe(await auth.hashPassword('abc12345'));
        expect(await auth.verifyPassword('abc12345', hash)).toBe(true);
        expect(await auth.verifyPassword('errada', hash)).toBe(false);
    });
});

describe('modo aberto e setup', () => {
    it('sem API_TOKEN, usuários e chaves: API aberta (compatível) e setup pendente', async () => {
        const status = await request(app).get('/api/v1/auth/status');
        expect(status.body.data).toMatchObject({ authRequired: false, setupRequired: true });
        expect((await request(app).get('/api/v1/sessions')).status).toBe(200);
        expect((await request(app).get('/status?sessionName=s1')).status).toBe(200);
    });

    it('setup cria o admin, loga com cookie seguro e fecha a API', async () => {
        const res = await request(app)
            .post('/api/v1/auth/setup')
            .send({ email: 'Admin@Exemplo.com', name: 'Admin', password: 'senha-forte-1' });
        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ email: 'admin@exemplo.com', role: 'admin' });
        expect(res.body.data).not.toHaveProperty('passwordHash');
        const cookie = res.headers['set-cookie'][0];
        expect(cookie).toMatch(/^myzap_session=/);
        expect(cookie).toMatch(/HttpOnly/);
        expect(cookie).toMatch(/SameSite=Strict/);

        expect((await request(app).get('/api/v1/sessions')).status).toBe(401);
        expect((await request(app).get('/status?sessionName=s1')).status).toBe(401);
        const again = await request(app)
            .post('/api/v1/auth/setup')
            .send({ email: 'x@exemplo.com', name: 'X', password: 'senha-forte-2' });
        expect(again.status).toBe(409);
    });

    it('com API_TOKEN, o setup exige o token', async () => {
        config.apiToken = 'mestre';
        try {
            const body = { email: 'a@exemplo.com', name: 'A', password: 'senha-forte-1' };
            expect((await request(app).post('/api/v1/auth/setup').send(body)).status).toBe(401);
            const ok = await request(app).post('/api/v1/auth/setup').set('Authorization', 'Bearer mestre').send(body);
            expect(ok.status).toBe(201);
        } finally {
            config.apiToken = null;
        }
    });

    it('valida e-mail e tamanho da senha', async () => {
        const res = await request(app).post('/api/v1/auth/setup').send({ email: 'x', name: 'X', password: '123' });
        expect(res.status).toBe(400);
        expect(res.body.error.details.map(detail => detail.field).sort()).toEqual(['email', 'password']);
    });
});

describe('login', () => {
    it('credenciais erradas, login, me e logout', async () => {
        await setupAdmin();
        const wrong = await request(app)
            .post('/api/v1/auth/login')
            .send({ email: 'admin@exemplo.com', password: 'errada' });
        expect(wrong.status).toBe(401);
        expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
        const unknown = await request(app)
            .post('/api/v1/auth/login')
            .send({ email: 'ninguem@exemplo.com', password: 'qualquer' });
        expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');

        const agent = request.agent(app);
        const ok = await agent
            .post('/api/v1/auth/login')
            .send({ email: 'ADMIN@exemplo.com', password: 'senha-forte-1' });
        expect(ok.status).toBe(200);
        expect(ok.body.data.lastLoginAt).not.toBeNull();
        const me = await agent.get('/api/v1/auth/me');
        expect(me.body.data).toMatchObject({ type: 'user', role: 'admin', user: { email: 'admin@exemplo.com' } });

        await agent.post('/api/v1/auth/logout');
        expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
    });

    it('trocar a senha invalida os outros logins', async () => {
        const admin = await setupAdmin();
        const other = request.agent(app);
        await other.post('/api/v1/auth/login').send({ email: 'admin@exemplo.com', password: 'senha-forte-1' });

        const bad = await admin
            .patch('/api/v1/auth/me')
            .send({ currentPassword: 'errada', newPassword: 'nova-senha-1' });
        expect(bad.status).toBe(400);
        const ok = await admin
            .patch('/api/v1/auth/me')
            .send({ currentPassword: 'senha-forte-1', newPassword: 'nova-senha-1' });
        expect(ok.status).toBe(200);

        expect((await admin.get('/api/v1/auth/me')).status).toBe(200); // recebeu cookie novo
        expect((await other.get('/api/v1/auth/me')).status).toBe(401);
    });
});

describe('papéis', () => {
    it('atendente usa conversas, mas não gerencia sessões, usuários nem rotas antigas', async () => {
        const admin = await setupAdmin();
        const { agent } = await createUser(admin, {
            email: 'atendente@exemplo.com',
            name: 'Ana',
            password: 'senha-atendente'
        });
        expect((await agent.get('/api/v1/conversations')).status).toBe(200);
        expect((await agent.get('/api/v1/sessions')).status).toBe(200);
        const forbidden = await agent.post('/api/v1/sessions').send({ name: 's1' });
        expect(forbidden.status).toBe(403);
        expect(forbidden.body.error.code).toBe('FORBIDDEN');
        expect((await agent.get('/api/v1/users')).status).toBe(403);
        expect((await agent.get('/status?sessionName=s1')).status).toBe(403);
    });

    it('desativar o usuário derruba o login', async () => {
        const admin = await setupAdmin();
        const { agent, user } = await createUser(admin, {
            email: 'b@exemplo.com',
            name: 'B',
            password: 'senha-b-123'
        });
        await admin.patch('/api/v1/users/' + user.id).send({ active: false });
        expect((await agent.get('/api/v1/conversations')).status).toBe(401);
        const login = await request(app)
            .post('/api/v1/auth/login')
            .send({ email: 'b@exemplo.com', password: 'senha-b-123' });
        expect(login.status).toBe(401);
    });

    it('não deixa ficar sem admin nem remover a si mesmo', async () => {
        const admin = await setupAdmin();
        const [me] = (await admin.get('/api/v1/users')).body.data;
        expect((await admin.patch('/api/v1/users/' + me.id).send({ role: 'agent' })).body.error.code).toBe(
            'LAST_ADMIN'
        );
        expect((await admin.delete('/api/v1/users/' + me.id)).body.error.code).toBe('CANNOT_DELETE_SELF');
        const dup = await admin
            .post('/api/v1/users')
            .send({ email: 'admin@exemplo.com', name: 'X', password: '12345678' });
        expect(dup.status).toBe(409);
    });
});

describe('chaves de API', () => {
    it('cria (mostra uma vez), usa, não gerencia usuários e revoga', async () => {
        const admin = await setupAdmin();
        const created = await admin.post('/api/v1/api-keys').send({ name: 'ERP' });
        expect(created.status).toBe(201);
        const { key, id } = created.body.data;
        expect(key).toMatch(/^mzk_/);
        expect(created.body.data).not.toHaveProperty('keyHash');

        const list = await admin.get('/api/v1/api-keys');
        expect(list.body.data[0]).toMatchObject({
            name: 'ERP',
            prefix: key.slice(0, 10),
            createdBy: { name: 'Admin' }
        });
        expect(list.body.data[0]).not.toHaveProperty('key');

        const bearer = url =>
            request(app)
                .get(url)
                .set('Authorization', 'Bearer ' + key);
        expect((await bearer('/api/v1/sessions')).status).toBe(200);
        expect((await bearer('/status?sessionName=s1')).status).toBe(200);
        expect((await bearer('/api/v1/users')).status).toBe(403);
        expect((await bearer('/api/v1/auth/me')).body.data).toMatchObject({ type: 'apikey', role: 'integration' });

        await admin.delete('/api/v1/api-keys/' + id);
        expect((await bearer('/api/v1/sessions')).status).toBe(401);
        // ?token= não aceita chave de API (só o API_TOKEN legado)
        expect((await request(app).get('/status?sessionName=s1&token=' + key)).status).toBe(401);
    });

    it('chave só por existir já fecha a API aberta', async () => {
        await db().apiKey.create({ data: { name: 'k', prefix: 'mzk_x', keyHash: 'h' } });
        auth.refreshAuthState();
        expect((await request(app).get('/api/v1/sessions')).status).toBe(401);
    });
});

describe('limite de tentativas', () => {
    it('bloqueia após 10 logins errados', async () => {
        await setupAdmin();
        let last;
        for (let i = 0; i < 11; i++) {
            last = await request(app).post('/api/v1/auth/login').send({ email: 'admin@exemplo.com', password: 'x' });
        }
        expect(last.status).toBe(429);
        expect(last.body.error.code).toBe('TOO_MANY_ATTEMPTS');
    });
});
