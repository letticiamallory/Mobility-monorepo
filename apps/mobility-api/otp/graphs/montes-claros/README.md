# OTP — Montes Claros (MG)

Coloque nesta pasta os insumos do **OpenTripPlanner 2.9** para Montes Claros.

## Conteúdo esperado

| Arquivo | Obrigatório | Notas |
|---------|-------------|--------|
| `*.osm.pbf` | Sim | Mapa OSM em **PBF** (não use XML cru como único arquivo). |
| `*.zip` (GTFS) | Opcional | Feed(s) de ônibus/transporte público. Sem GTFS, o OTP roda só **rede viária + caminhada** (e modo transit limitado). |
| `graph.obj` | Gerado | Criado por `--build --save`. Não versionar (está no `.gitignore`). |

## Migração da pasta antiga `otp/graph/`

Se você já tinha tudo em `otp/graph/`, copie para cá:

```powershell
cd C:\Users\lett\Desktop\mobility-api\otp
Copy-Item -Recurse -Force .\graph\* .\graphs\montes-claros\
```

(Ajuste o caminho se o seu projeto estiver em outro diretório.)

## Build do grafo (host Windows, sem Docker)

```powershell
cd C:\Users\lett\Desktop\mobility-api\otp
java -Xmx1536m -jar otp-shaded-2.9.0.jar --build --save .\graphs\montes-claros
```

## API Nest

Com **duas cidades** no Docker (ver `docker-compose.otp.yml`):

```env
OTP_URL=http://localhost:8080
OTP_URL_MONTES_CLAROS=http://localhost:8080
OTP_URL_BRASILIA=http://localhost:8081
OTP_URL_SAO_PAULO=http://localhost:8082
```

Com **um único** OTP só para Montes Claros:

```env
OTP_URL=http://localhost:8080
```
