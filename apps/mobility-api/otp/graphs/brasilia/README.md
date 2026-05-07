# OTP — Brasília / Distrito Federal

Pasta de insumos para uma instância OTP dedicada à região de **Brasília e entorno** (bbox ampliada no código da API: `otp-region.util.ts`).

## 1. Mapa OSM (PBF)

Recomendado para **não** baixar o Brasil inteiro (~2 GB): usar o extrato Geofabrik **Centro-Oeste**, que inclui o DF, Goiás, MT, MS (~165 MB em 2026):

- https://download.geofabrik.de/south-america/brazil/centro-oeste-latest.osm.pbf

Baixe e salve nesta pasta, por exemplo:

- `centro-oeste-latest.osm.pbf`

(O nome pode ser qualquer um, desde que seja `.osm.pbf`.)

## 2. GTFS (transporte público do DF)

Fontes oficiais / agregadores (verifique licença e atualização):

- Portal de dados do DF — organização **DFTRANS**: https://www.dados.df.gov.br/organization/about/dftrans-transporte-urbano-do-df  
- Conjuntos em https://dados.df.gov.br/dataset — busque por **GTFS** ou “transporte coletivo”.
- [Mobility Database](https://mobilitydatabase.org/) — pesquise por Brasília / Distrito Federal.

Coloque um ou mais arquivos `*.zip` (GTFS) **nesta pasta**. O OTP 2.x carrega todos os ZIPs do diretório do build.

## 3. Compilar o grafo

**Máquina com pouca RAM (ex.: 8 GB):** feche outros apps. O extrato **Centro-Oeste** costuma exigir **pelo menos ~3 GB de heap** no `--build` (com `1536m` o Java pode dar `OutOfMemoryError`).

```powershell
cd C:\Users\lett\Desktop\mobility-api\otp
java -Xmx3072m -jar otp-shaded-2.9.0.jar --build --save .\graphs\brasilia
```

Isso gera `graph.obj` dentro de `graphs/brasilia/`.

## 4. Subir só esta cidade (local)

```powershell
java -Xmx1536m -jar otp-shaded-2.9.0.jar --load --serve .\graphs\brasilia
```

(Porta padrão 8080; em Docker veja `docker-compose.otp.yml` — Brasília publicada em **8081** no host.)

## 5. API Nest (multi-cidade)

```env
OTP_URL=http://localhost:8080
OTP_URL_MONTES_CLAROS=http://localhost:8080
OTP_URL_BRASILIA=http://localhost:8081
OTP_URL_SAO_PAULO=http://localhost:8082
```

A API escolhe o servidor OTP conforme as coordenadas de origem/destino (Montes Claros × Brasília). Rotas que **misturam** as duas regiões caem no `OTP_URL` padrão ou no fallback Google — comportamento esperado.
