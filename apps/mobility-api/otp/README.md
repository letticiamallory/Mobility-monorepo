# OpenTripPlanner (OTP) — mobility-api

Suporte a **duas regiões** em paralelo:

| Região | Pasta de grafo | Porta no Docker Compose (host) |
|--------|----------------|---------------------------------|
| Montes Claros (MG) | `graphs/montes-claros/` | **8080** |
| Brasília / DF | `graphs/brasilia/` | **8081** |
| São Paulo (SP) | `graphs/sao-paulo/` | **8082** |

## Início rápido com Docker (stack único)

Um único Compose sobe **OTP (3 regiões) + Postgres + API Nest + job de linhas/horários** (`lines-seed` roda só quando o banco está vazio ou sem horários).

1. Gere `graph.obj` em **cada** pasta (no Windows ou em CI) — veja os `README.md` dentro de `graphs/montes-claros/`, `graphs/brasilia/` e `graphs/sao-paulo/`.
2. Confirme que `otp-shaded-2.9.0.jar` está nesta pasta (`otp/`).
3. Na **raiz** do `mobility-api`, tenha um `.env` com suas chaves (Google, Gemini, etc.). O Compose injeta `DATABASE_*` e **sobrescreve** `OTP_URL_*` para os hostnames internos dos serviços OTP — não precisa mudar o `.env` para Docker nesse ponto.
4. Suba tudo:

```powershell
cd C:\Users\lett\Desktop\mobility-api
docker compose up --build
```

Ou só a partir de `otp/`:

```powershell
cd C:\Users\lett\Desktop\mobility-api\otp
docker compose -f docker-compose.otp.yml up --build
```

- API: `http://localhost:3000`  
- OTP: portas **8080 / 8081 / 8082** como antes.

### Linhas e horários no banco (`POST /lines/seed`)

O seed agora agrega **três regiões** (campo `region` na tabela `lines`):

| Região | Fonte | Horários (grade) |
|--------|--------|-------------------|
| `montes_claros` | onibusmoc.com | Sim |
| `brasilia` | brasiliamobilidade.com.br | Sim (HTML) |
| `sao_paulo` | GTFS público SPTrans (`POST /lines/seed`) | Não — só catálogo; opcional `SPTRANS_GTFS_URL` |

Limite opcional de linhas DF por execução: `LINES_BRASILIA_MAX_TRAVELS` (padrão **1200**).

### API só no host (sem Docker), OTP no Docker

Aí sim use no `.env` do Nest:

```env
OTP_URL=http://localhost:8080
OTP_URL_MONTES_CLAROS=http://localhost:8080
OTP_URL_BRASILIA=http://localhost:8081
OTP_URL_SAO_PAULO=http://localhost:8082
```

A API (`OtpService`) escolhe o servidor conforme origem/destino (bbox em `src/routes/utils/otp-region.util.ts`).

## Pasta legada `otp/graph/`

O layout antigo (tudo em `graph/`) ainda funciona para quem não migrou. O recomendado é usar **`graphs/montes-claros/`** e copiar os arquivos para lá (instruções no README da subpasta).

## Por que o erro “Unexpectedly long header / Possibly corrupt file”?

O OTP 2.x lê OSM em **PBF** (`.osm.pbf`). Export XML do Overpass não é PBF — converta com Osmosis (ver seção abaixo) ou baixe PBF do Geofabrik.

## Converter XML → PBF (Windows)

Requer **Java** (`JAVA_HOME` ou `java` no PATH). Osmosis em `tools/` (não versionado — ver `.gitignore`).

```powershell
cd C:\Users\lett\Desktop\mobility-api\otp
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-25.0.3.9-hotspot"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
.\tools\osmosis-0.49.2\osmosis-0.49.2\bin\osmosis.bat `
  --read-xml .\graphs\montes-claros\montes-claros.overpass-export.xml `
  --write-pbf .\graphs\montes-claros\montes-claros.osm.pbf
```

## Compilar o grafo (host, uma cidade)

```powershell
cd C:\Users\lett\Desktop\mobility-api\otp
java -Xmx1536m -jar otp-shaded-2.9.0.jar --build --save .\graphs\montes-claros
```

## Subir OTP local (uma cidade, sem Docker)

```powershell
java -Xmx1536m -jar otp-shaded-2.9.0.jar --load --serve .\graphs\montes-claros
```

## GTFS

Sem arquivos `*.zip` GTFS na pasta do grafo, o OTP usa sobretudo **rede viária + caminhada**. Com GTFS, passa a planejar **trânsito** (horários, linhas).

## Referência

- Detalhes por cidade: `graphs/montes-claros/README.md`, `graphs/brasilia/README.md`
- Variáveis Nest: `README.md` raiz do projeto (Integrações) e `docs/OTP_WHEELCHAIR_SERVER.md`
