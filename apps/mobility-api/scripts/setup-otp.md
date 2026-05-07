# Setup OpenTripPlanner para Montes Claros

## 1. Baixar o OTP
wget https://github.com/opentripplanner/OpenTripPlanner/releases/download/v2.5.0/otp-2.5.0-shaded.jar

## 2. Baixar dados do OpenStreetMap de Montes Claros
wget "https://overpass-api.de/api/map?bbox=-43.95,-16.80,-43.75,-16.65" -O montes-claros.osm

## 3. Rodar o OTP
java -Xmx2G -jar otp-2.5.0-shaded.jar --build --serve ./graph

## 4. Testar a API
curl "http://localhost:8080/otp/routers/default/plan?fromPlace=-16.7089,-43.8723&toPlace=-16.7445,-43.8534&mode=TRANSIT,WALK&wheelchair=true"
