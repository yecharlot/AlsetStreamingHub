# Alset Streaming Hub

Plataforma de **transmisión multi-cámara en vivo** (partidos / eventos) sobre el ecosistema Alset:

- **WebRTC** — captura y encode en el móvil (productor); espectadores reciben el stream.
- **Cloudflare Worker + Durable Object** — sala del partido, señalización, tickets de pago, métricas de calidad.
- **UI** — inspirada en nodos/pulsos de Alset-JS-Runtime (conmutar fuente = elegir cámara).
- **PrismaTec / genes** — pueden llamar las APIs HTTP del hub como sondas de borde (estado de sala, tickets).

## Roles

| Rol | URL |
|-----|-----|
| Inicio | `/` |
| Publicar (móvil) | `/publish.html?match=partido-demo&label=Tribuna` |
| Ver | `/watch.html?match=partido-demo&ticket=CODIGO` |
| Director | `/director.html?match=partido-demo` |

## API

- `GET /api/health`
- `GET /api/room/:matchId/state`
- `POST /api/admin/ticket` — body `{ matchId, maxUses }` + header opcional `X-Admin-Key`
- `WS /ws/:matchId?role=publisher|viewer|director&ticket=`

## Cobro

1. Organizador crea tickets (`/api/admin/ticket`).
2. Cuando existen tickets, viewers/director deben enviar `ticket` válido.
3. Puedes vender el código fuera (Stripe, transferencia, etc.) y solo validar aquí.

## Deploy

```bash
npm i
npx wrangler login   # o CLOUDFLARE_API_TOKEN
npx wrangler deploy
```

Variable opcional: `STREAM_ADMIN_KEY` en el dashboard del Worker.

## Límites honestos

- MVP mesh: cada viewer negocia con el publisher (escala limitada).
- Para muchos espectadores: añadir SFU (Cloudflare Calls / LiveKit) sin cambiar la UX del hub.
- TURN puede ser necesario en redes restrictivas (ampliable).

## SaaS (v1)

Ver **[SAAS.md](SAAS.md)** — organizaciones, planes, genes de borde que nacen/mueren con la transmisión, consola en `/console.html`.

MIT · Ecosistema Alset
