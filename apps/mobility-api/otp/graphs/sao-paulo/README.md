# OTP — São Paulo (SP) / SPTrans

Esta pasta contém os insumos do **OpenTripPlanner 2.9** para uma instância dedicada à região de **São Paulo**.

## 1. Mapa OSM (PBF)

### Opção A (recomendado): recorte por bbox (menos RAM)

O Geofabrik **não** oferece um `.osm.pbf` separado só do estado de SP. O menor extrato que inclui SP é o **Sudeste** (~800 MB), o que costuma estourar heap na etapa de build do OTP.

Por isso, a recomendação é:

1) Baixar o extrato **Sudeste**:

- `https://download.geofabrik.de/south-america/brazil/sudeste-latest.osm.pbf`

2) Recortar apenas a bbox de São Paulo (aproximação metropolitana) com Osmosis:

```powershell
cd C:\Users\lett\Desktop\mobility-api\otp
.\tools\osmosis-0.49.2\osmosis-0.49.2\bin\osmosis.bat `
  --read-pbf .\graphs\sao-paulo\sudeste-latest.osm.pbf `
  --bounding-box top=-23.0 left=-47.3 bottom=-24.2 right=-46.1 `
  --write-pbf .\graphs\sao-paulo\sao-paulo-bbox.osm.pbf
```

3) Apague (ou mova para fora da pasta do grafo) o `sudeste-latest.osm.pbf`, para o OTP não tentar carregar os dois PBFs.

### Opção B: usar o extrato Sudeste completo (mais RAM)

Se você tiver RAM/heap sobrando, pode manter o `sudeste-latest.osm.pbf` e buildar direto com ele.

#### Nomes esperados

Você pode usar qualquer nome `.osm.pbf`. Exemplos:

- `sudeste-latest.osm.pbf`
- `sao-paulo-bbox.osm.pbf`

## 2. GTFS (SPTrans)

Coloque nesta pasta um arquivo `*.zip` GTFS da SPTrans (o OTP 2.x carrega todos os ZIPs do diretório do build):

- **Mobility Database (mirror):** `https://files.mobilitydatabase.org/mdb-8/latest.zip`
- **SPTrans (fonte):** `https://www.sptrans.com.br/umbraco/Surface/PerfilDesenvolvedor/BaixarGTFS?memberName=sptrans`

Sugestão de nome:

- `sptrans-gtfs.zip`

## 3. Compilar o grafo

Se você estiver usando o `sao-paulo-bbox.osm.pbf` (recomendado), normalmente **4 GB** de heap já é suficiente.

```powershell
cd C:\Users\lett\Desktop\mobility-api\otp
java -Xmx4096m -jar otp-shaded-2.9.0.jar --build --save .\graphs\sao-paulo
```

Isso gera `graph.obj` dentro de `graphs/sao-paulo/`.

## 4. Subir só esta cidade (local)

```powershell
java -Xmx2048m -jar otp-shaded-2.9.0.jar --load --serve .\graphs\sao-paulo
```

(Porta padrão 8080; em Docker veja `docker-compose.otp.yml` — São Paulo publicada em **8082** no host.)

