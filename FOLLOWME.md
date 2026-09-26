# FOLLOWME — Probar Alset Streaming Hub de punta a punta

Guía secuencial para validar **todos los casos de uso** del hub (API, SaaS, tickets, UI, WebRTC).

**Base de producción usada en la batería automatizada (2026-09-26):**  
`https://alset-streaming-hub.lhmolam-877.workers.dev`

> **Importante:** Cloudflare Bot Fight puede devolver **403 / Error 1010** a clientes sin navegador real.  
> Usa un navegador o `curl` con User-Agent de navegador:
> ```bash
> UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
> curl -sS -A "$UA" "$BASE/api/health"
> ```

---

## 0. Preparación

```bash
export BASE="https://alset-streaming-hub.lhmolam-877.workers.dev"
export UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
export MATCH="mi-partido-$(date +%s)"   # mismo nombre en TX y RX
```

Local (opcional):

```bash
cd AlsetStreamingHub
npm i
npx wrangler dev          # Worker + UI en localhost
# o solo UI proxy → Worker:
STREAM_UPSTREAM="$BASE" npm start   # :10000
```

Necesitas **2 dispositivos** (móvil + PC) para la parte de video.

---

## 1. Salud del servicio

```bash
curl -sS -A "$UA" "$BASE/api/health" | jq .
```

**Esperado:** `"ok": true`, `"service": "alset-streaming-hub"`, planes `free|pro|event`.

| Resultado batería | PASS |
|-------------------|------|
| `GET /api/health` | ✅ 200 — v1.0.0-saas, `sfu: true` |

---

## 2. Páginas UI (casos de uso de pantalla)

Abre en el navegador (HTTPS del Worker):

| Paso | URL | Rol |
|------|-----|-----|
| 2.1 | `$BASE/publish.html?match=$MATCH&label=Tribuna` | Transmitir (cámara) |
| 2.2 | `$BASE/watch.html?match=$MATCH` | Ver |
| 2.3 | `$BASE/director.html?match=$MATCH` | Director / multi-cámara |
| 2.4 | `$BASE/console.html` | Panel SaaS |
| 2.5 | `$BASE/pay.html?match=$MATCH` | Pago / Transfermóvil |
| 2.6 | `$BASE/production.html` / `program.html` | Producción (si aplica) |

```bash
for p in publish.html watch.html director.html console.html pay.html production.html program.html; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" -A "$UA" "$BASE/$p")
  echo "$code  $p"
done
```

| Resultado batería | |
|-------------------|--|
| `publish`, `watch`, `director`, `console`, `pay`, `production`, `program` | ✅ 200 |
| `/` (raíz) | ❌ **404** — no sirve `index.html` (ver hallazgos) |

---

## 3. Estado de sala

```bash
curl -sS -A "$UA" "$BASE/api/room/$MATCH/state" | jq .
```

**Esperado:** JSON `type: room_state`, `meta.status`, listas de producers/viewers.

| Resultado | ✅ PASS — sala se crea al consultar state |

---

## 4. SaaS — organización y plan

```bash
# 4.1 Crear org (guarda el apiKey: se muestra una vez)
curl -sS -A "$UA" -X POST "$BASE/api/saas/orgs" \
  -H "Content-Type: application/json" \
  -d '{"name":"Club Prueba","plan":"free"}' | jq .

export API_KEY="ash_..."   # del JSON

# 4.2 Quién soy
curl -sS -A "$UA" "$BASE/api/saas/me" -H "X-API-Key: $API_KEY" | jq .

# 4.3 Uso
curl -sS -A "$UA" "$BASE/api/saas/usage" -H "X-API-Key: $API_KEY" | jq .

# 4.4 Registrar datos Transfermóvil
curl -sS -A "$UA" -X POST "$BASE/api/saas/payments" \
  -H "Content-Type: application/json" -H "X-API-Key: $API_KEY" \
  -d '{"provider":"transfermovil","amount":100,"currency":"CUP"}' | jq .
```

| Resultado batería | |
|-------------------|--|
| Crear org free | ✅ |
| `/api/saas/me` | ✅ |
| `/api/saas/usage` | ✅ |
| `/api/saas/payments` | ✅ `activeProvider: transfermovil` |

---

## 5. Bootstrap / genes / fin de evento (API documentada)

```bash
curl -sS -A "$UA" -X POST "$BASE/api/room/$MATCH/bootstrap" \
  -H "Content-Type: application/json" -H "X-API-Key: $API_KEY" \
  -d '{"title":"Final de prueba"}' | jq .

curl -sS -A "$UA" "$BASE/api/room/$MATCH/genes" | jq .

curl -sS -A "$UA" -X POST "$BASE/api/room/$MATCH/end" -H "X-API-Key: $API_KEY" | jq .
```

| Resultado batería | |
|-------------------|--|
| `POST .../bootstrap` | ❌ **404** `not_found` |
| `GET .../genes` | ❌ **404** |
| `POST .../end` | ❌ **404** |

**Causa (código):** el Worker reenvía a rutas DO `/bootstrap`, `/genes`, `/end`, pero `MatchRoom` en `src/room.js` **solo implementa** `/state`, `/meta`, `/ticket`, `/ticket/check` y WebSocket. Hay que añadir esos handlers en el DO (o dejar de documentarlos hasta implementarlos).

**Alternativa actual para “abrir” sala:** basta con que alguien abra publish/watch con el mismo `match` (el DO nace al primer `/state` o WS).

---

## 6. Tickets de acceso

```bash
# 6.1 Crear ticket (admin o con API key)
curl -sS -A "$UA" -X POST "$BASE/api/admin/ticket" \
  -H "Content-Type: application/json" \
  -d "{\"matchId\":\"$MATCH\",\"maxUses\":3}" | jq .

export TICKET="XX7JFK"   # code del JSON
```

Ver con ticket:

```text
$BASE/watch.html?match=$MATCH&ticket=$TICKET
```

| Resultado batería | |
|-------------------|--|
| `POST /api/admin/ticket` | ✅ código tipo `XX7JFK` |
| `POST /api/room/:id/ticket` | ❌ no enrutado en Worker (404) |
| `POST /api/room/:id/ticket/check` | ❌ no enrutado (el check existe **dentro** del DO, pero falta proxy en `index.js`) |

**Hallazgo:** la creación de tickets vía **admin** funciona. El check HTTP público por path de room no está expuesto; el gate real de ticket ocurre al conectar el **WebSocket** (`?ticket=`).

---

## 7. Pago público del partido

```bash
curl -sS -A "$UA" "$BASE/api/pay/match/$MATCH" | jq .
```

Abre: `$BASE/pay.html?match=$MATCH`

| Resultado | ✅ API responde; sin org ligada al match muestra pagos `none` / mensaje claro |

---

## 8. SFU (Cloudflare Calls)

```bash
curl -sS -A "$UA" -X POST "$BASE/api/sfu/session" \
  -H "Content-Type: application/json" \
  -d "{\"matchId\":\"$MATCH\"}" | jq .
```

| Resultado batería | ✅ 200 — `sessionId` + STUN Cloudflare (`sfu: true` en health) |

---

## 9. WebRTC — caso de uso principal (MANUAL)

Secuencia obligatoria en dispositivos reales:

1. **Móvil A (TX)**  
   `$BASE/publish.html?match=$MATCH&label=Tribuna`  
   - Permitir cámara/mic  
   - Conectar / publicar  
   - Debe verse preview local  

2. **PC o Móvil B (RX)**  
   `$BASE/watch.html?match=$MATCH`  
   - En &lt;15 s debe verse el video de A  

3. **Segunda cámara (opcional)**  
   `$BASE/publish.html?match=$MATCH&label=Home`  

4. **Director**  
   `$BASE/director.html?match=$MATCH`  
   - Listar cámaras y conmutar programa  

5. **Con ticket**  
   Crear ticket (paso 6) →  
   `$BASE/watch.html?match=$MATCH&ticket=$TICKET`  

| Resultado batería automatizada | ⏭️ SKIP (sin cámara en CI) — **debes marcarlo tú** |

Checklist manual:

- [ ] Preview TX OK  
- [ ] RX ve video  
- [ ] Audio OK (si aplica)  
- [ ] 2 cámaras + director  
- [ ] Ticket bloquea / permite según diseño actual  

---

## 10. Consola SaaS (UI)

1. Abrir `$BASE/console.html`  
2. Crear org / pegar API key  
3. Generar ticket para un `match`  
4. Copiar links publish / watch  
5. (Cuando exista end) terminar evento  

---

## Resumen de la batería automatizada (2026-09-26)

| Métrica | Valor |
|---------|-------|
| **PASS** | 22 |
| **FAIL** | 7 (varios esperables por rutas no implementadas / index) |
| **SKIP** | 1 (WebRTC manual) |
| **Match de prueba** | `fm-test-1790402900` |
| **Ticket ejemplo** | `XX7JFK` (ya puede estar agotado/expirado) |

### Tabla por caso de uso

| Caso de uso | Endpoint / UI | Resultado |
|-------------|---------------|-----------|
| Salud API | `GET /api/health` | ✅ |
| Landing `/` | `GET /` | ❌ 404 |
| Publicar UI | `publish.html` | ✅ HTML |
| Ver UI | `watch.html` | ✅ HTML |
| Director UI | `director.html` | ✅ HTML |
| Consola SaaS | `console.html` | ✅ HTML |
| Pago UI | `pay.html` | ✅ HTML |
| Estado sala | `GET /api/room/:id/state` | ✅ |
| Crear org | `POST /api/saas/orgs` | ✅ |
| Plan / me | `GET /api/saas/me` | ✅ |
| Usage | `GET /api/saas/usage` | ✅ |
| Payments config | `POST /api/saas/payments` | ✅ |
| Bootstrap sala | `POST .../bootstrap` | ❌ DO sin ruta |
| Genes vivos | `GET .../genes` | ❌ DO sin ruta |
| Fin evento | `POST .../end` | ❌ DO sin ruta |
| Ticket admin | `POST /api/admin/ticket` | ✅ |
| Ticket room HTTP | `POST .../ticket` | ❌ sin proxy Worker |
| Ticket check HTTP | `POST .../ticket/check` | ❌ sin proxy Worker |
| Pay match | `GET /api/pay/match/:id` | ✅ |
| SFU session | `POST /api/sfu/session` | ✅ |
| Publish→Watch video | WebRTC | ⏭️ manual |

---

## Hallazgos (para priorizar arreglo)

1. **Bot protection (1010)**  
   Peticiones sin UA de navegador → 403. Afecta scripts/CI. Mitigar: UA real, o reglas CF menos agresivas en `/api/*`.

2. **`/` → 404**  
   Con `html_handling = "none"` en `wrangler.toml`, la raíz no reescribe a `index.html`. Existe `public/index.html`.  
   **Fix:** servir `/` → `index.html` en el Worker o cambiar assets config.

3. **Bootstrap / genes / end documentados pero no implementados en `MatchRoom`**  
   El Worker reenvía; el DO responde `not_found`.  
   **Fix:** implementar en `room.js` o quitar de la API pública hasta estar listos.

4. **Ticket check HTTP no expuesto**  
   Admin ticket sí; falta en `index.js` proxy a `/ticket` y `/ticket/check` del DO para paths `/api/room/:id/...`.

5. **`meta.id` siempre `"default"` en ensureMeta**  
   Cosmético; el DO se aísla por `idFromName(matchId)`, pero el JSON confunde. Poner `meta.id = matchId` en bootstrap/ensureMeta.

6. **SFU configurado en prod**  
   Buena señal para planes pro/event; validar en carga real con muchos viewers.

7. **WebRTC no se puede certificar solo con curl**  
   La prueba que “da la cuenta” al negocio es el paso 9 en dos dispositivos.

---

## Orden mínimo si solo tienes 10 minutos

1. `GET /api/health` con UA → OK  
2. Móvil: `publish.html?match=demo1&label=Cam1`  
3. PC: `watch.html?match=demo1` → ¿hay video?  
4. `POST /api/admin/ticket` → watch con `?ticket=`  
5. `console.html` → crear org free  

Si el paso 3 falla, el producto aún no está listo para cobrar entradas.

---

## Criterio “¿da la cuenta?”

| Nivel | Criterio |
|-------|----------|
| **Demo técnica** | Health + UI + state + 1 publish/watch con video |
| **Cobro de tickets** | Admin ticket + watch con código + pay.html usable |
| **SaaS vendible** | Orgs/planes + límites enforced + bootstrap/end reales + SFU estable + landing `/` |

Hoy (tras esta batería): **cerca de demo técnica + tickets admin + SaaS registry**; faltan rutas de ciclo de vida de sala, index, y prueba humana de video.

---

*Documento generado a partir de batería automatizada + lectura de `src/index.js` / `src/room.js` / `src/saas.js`. Actualiza la sección de resultados cuando re-despliegues.*
