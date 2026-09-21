# Alset Streaming Hub — SaaS (genes de borde)

## Modelo Alset

Cada transmisión es un **enjambre de genes** en el borde (Durable Object + SFU opcional):

| Gene | Cuándo nace | Cuándo muere |
|------|-------------|--------------|
| `stream.room` | Bootstrap del evento | `POST /api/room/:id/end` |
| `stream.publisher` | Cámara se conecta (WS) | Se desconecta o fin de evento |
| `stream.viewer` / `director` | Entra a ver / dirigir | Sale o fin de evento |

La **media** (video/audio) la escala **Cloudflare Calls (SFU)** cuando el plan lo requiere (`pro`, `event`) y hay `CALLS_APP_ID` / `CALLS_APP_SECRET`.  
Los genes **orquestan identidad, cupos y ciclo de vida**; no sustituyen el reenvío RTP del SFU.

## Planes

| Plan | Cámaras | Viewers | Eventos live | SFU |
|------|---------|---------|--------------|-----|
| free | 2 | 25 | 1 | no obligatorio |
| pro | 8 | 300 | 10 | sí |
| event | 12 | 1000 | 1 | sí |

## API rápida

```bash
# Crear org (devuelve apiKey una vez)
curl -X POST /api/saas/orgs -H 'Content-Type: application/json' \
  -d '{"name":"Mi Club","plan":"pro"}'

# Mi plan
curl /api/saas/me -H 'X-API-Key: ash_...'

# Abrir sala (room gene)
curl -X POST /api/room/partido-1/bootstrap -H 'X-API-Key: ash_...' \
  -H 'Content-Type: application/json' -d '{"title":"Final"}'

# Genes vivos
curl /api/room/partido-1/genes

# Cerrar y destruir enjambre
curl -X POST /api/room/partido-1/end
```

## Consola

`/console.html` — crear org, bootstrap, tickets, ver genes, terminar evento.

## Deploy

```bash
npx wrangler deploy
# Migración v2-saas crea el DO SaaSRegistry
```


## Cobros

- **Ahora:** Transfermóvil (titular, teléfono, últimos 4, banco, monto, instrucciones) en `POST /api/saas/payments`.
- **Página pública:** `/pay.html?match=EVENTO` → `GET /api/pay/match/:id`.
- **Futuro:** campos Stripe / PayPal / Payoneer guardados; integración online pendiente.
- **Flujo actual:** cliente paga → organizador confirma → genera ticket en consola.

## Uso

`GET /api/saas/usage` — eventos, tickets, picos, historial.

TURN (redes difíciles): aplazado a próxima versión.
