-- Colunas opcionais; linhas existentes permanecem com NULL até o usuário preencher no app.
ALTER TABLE users
ADD COLUMN IF NOT EXISTS phone character varying(32);

ALTER TABLE users
ADD COLUMN IF NOT EXISTS birth_date character varying(10);
