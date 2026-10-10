# Atalhos do ConectZap. `make` (ou `make help`) lista os comandos.
# Os alvos só chamam os scripts do npm e o docker compose: a fonte da verdade continua no package.json.

SHELL := /bin/bash
.DEFAULT_GOAL := help

COMPOSE ?= docker compose
SERVICE ?= conectzap
# o Chromium vem do sistema (ou da imagem Docker), não do puppeteer
export PUPPETEER_SKIP_DOWNLOAD := true

.PHONY: help setup install web-install env dev web-dev build start \
	test test-watch lint format format-check check \
	migrate studio backup \
	up down restart logs ps shell docker-build docker-dev docker-backup clean

help: ## Mostra esta ajuda
	@awk 'BEGIN { FS = ":.*## " } /^## / { printf "\n\033[1m%s\033[0m\n", substr($$0, 4) } /^[a-zA-Z_-]+:.*## / { printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo

## Instalação

setup: env install web-install build ## Primeira instalação local: .env, dependências e build do painel

install: ## Instala as dependências do servidor
	npm install

web-install: ## Instala as dependências do painel
	npm run web:install

env: ## Cria o .env a partir do .env_example (não sobrescreve)
	@if [ -f .env ]; then echo ".env já existe"; else cp .env_example .env && echo ".env criado: ajuste ADMIN_EMAIL e ADMIN_PASSWORD"; fi

## Desenvolvimento

dev: ## API com hot-reload (porta 3333)
	npm run dev

web-dev: ## Painel com hot-reload (porta 5173, repassa /api para a 3333)
	npm run web:dev

build: ## Compila o painel (web/dist)
	npm run build

start: ## Inicia o servidor (sem hot-reload)
	npm start

## Qualidade

test: ## Roda os testes
	npm test

test-watch: ## Testes em modo watch
	npm run test:watch

lint: ## Lint do servidor e do painel
	npm run lint
	npm --prefix web run lint

format: ## Formata o código (prettier)
	npm run format

format-check: ## Confere a formatação
	npm run format:check

check: ## Tudo o que o CI roda: lint, formatação, testes e typecheck do painel
	npm run check

## Banco de dados

migrate: ## Cria/aplica migration após alterar o schema (make migrate name=minha_mudanca)
	@if [ -z "$(name)" ]; then echo "uso: make migrate name=<nome_da_migration>"; exit 1; fi
	npm run db:migrate -- --name $(name)

studio: ## Abre o banco no navegador (Prisma Studio)
	npm run db:studio

backup: ## Backup do SQLite em DATA_DIR/backups (make backup keep=30)
	npm run db:backup $(if $(keep),-- --keep $(keep),)

## Docker

up: ## Sobe o ConectZap em segundo plano (build se precisar)
	$(COMPOSE) up -d --build $(SERVICE)

down: ## Para e remove o container (os volumes ficam)
	$(COMPOSE) down

restart: ## Reinicia o container
	$(COMPOSE) restart $(SERVICE)

logs: ## Acompanha os logs
	$(COMPOSE) logs -f $(SERVICE)

ps: ## Situação dos containers
	$(COMPOSE) ps

shell: ## Abre um shell dentro do container
	$(COMPOSE) exec $(SERVICE) sh

docker-build: ## Gera a imagem de produção
	$(COMPOSE) build $(SERVICE)

docker-dev: ## Ambiente de desenvolvimento no Docker (código montado, hot-reload)
	$(COMPOSE) --profile dev up --build conectzap-dev

docker-backup: ## Backup do banco de dentro do container
	$(COMPOSE) exec $(SERVICE) npm run db:backup

## Limpeza

clean: ## Remove o build do painel e o cache do TypeScript (não toca em data/ nem tokens/)
	rm -rf web/dist web/node_modules/.tmp
