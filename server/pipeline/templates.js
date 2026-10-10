'use strict';

const SETTINGS = {
    timeoutMinutes: 30,
    handoffKeywords: ['atendente', 'humano'],
    handoffText: 'Tudo bem! Vou te passar para um atendente. 🙂'
};

const node = (id, type, x, y, data = {}) => ({ id, type, position: { x, y }, data });
const edge = (source, target, sourceHandle) => ({
    id: [source, sourceHandle, target].filter(Boolean).join('-'),
    source,
    target,
    ...(sourceHandle ? { sourceHandle } : {})
});

const TEMPLATES = {
    blank: () => ({
        nodes: [
            node('start', 'start', 0, 120),
            node('welcome', 'message', 260, 100, { text: 'Olá, {{contact.name}}! Obrigado por falar com a gente.' })
        ],
        edges: [edge('start', 'welcome')],
        settings: { ...SETTINGS }
    }),

    menu: () => ({
        nodes: [
            node('start', 'start', 0, 220),
            node('hours', 'businessHours', 220, 200, {
                timezone: 'America/Sao_Paulo',
                schedule: [
                    { days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00' },
                    { days: [6], start: '08:00', end: '12:00' }
                ]
            }),
            node('menu', 'menu', 500, 80, {
                text: 'Olá, {{contact.name}}! 👋 Como podemos ajudar?',
                options: [
                    { id: 'pedido', label: 'Fazer um pedido' },
                    { id: 'acompanhar', label: 'Acompanhar um pedido' },
                    { id: 'atendente', label: 'Falar com um atendente' }
                ]
            }),
            node('catalogo', 'message', 860, -60, {
                text: 'Ótimo! Veja nosso catálogo em https://exemplo.com.br/catalogo e mande aqui o que escolher.'
            }),
            node('fim-catalogo', 'end', 1160, -60, {}),
            node('numero', 'question', 860, 110, {
                text: 'Qual é o número do pedido?',
                variable: 'pedido',
                validation: 'number',
                invalidText: 'Digite só os números do pedido, por favor.'
            }),
            node('etiqueta', 'tag', 1160, 110, { tag: 'pedido' }),
            node('transferir-pedido', 'handoff', 1420, 110, {
                text: 'Obrigado! Um atendente vai verificar o pedido {{pedido}} e já te responde.'
            }),
            node('transferir', 'handoff', 860, 280, { text: 'Certo! Já vou te passar para um atendente.' }),
            node('fechado', 'message', 500, 380, {
                text: 'Nosso horário é de segunda a sexta, das 8h às 18h, e sábado até o meio-dia. Deixe sua mensagem que respondemos assim que abrirmos!'
            }),
            node('fim-fechado', 'end', 860, 420, {})
        ],
        edges: [
            edge('start', 'hours'),
            edge('hours', 'menu', 'open'),
            edge('hours', 'fechado', 'closed'),
            edge('menu', 'catalogo', 'pedido'),
            edge('catalogo', 'fim-catalogo'),
            edge('menu', 'numero', 'acompanhar'),
            edge('numero', 'etiqueta'),
            edge('etiqueta', 'transferir-pedido'),
            edge('menu', 'transferir', 'atendente'),
            edge('fechado', 'fim-fechado')
        ],
        settings: { ...SETTINGS }
    })
};

module.exports = { TEMPLATES };
