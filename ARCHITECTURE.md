# Arquitectura — Alset Streaming Hub (SaaS descentralizado)

Principio: **no reescribir el mesh WebRTC que ya funciona**. Solo se completan piezas de producto (ciclo de vida, límites, landing, tickets HTTP).

```
                    ┌─────────────────────────────┐
  Organizador       │  Console / API key (SaaS DO) │
  Espectador  ───►  │  Worker edge (Cloudflare)    │
  Cámara móvil      └─────────────┬───────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
      MatchRoom DO          SaaSRegistry DO      Calls SFU (opc.)
      · state / WS          · orgs / plans       · sesión media
      · tickets             · usage / liveIndex
      · bootstrap/genes/end · pagos (TM…)
              │
              ▼
        WebRTC mesh (publish ↔ watch)
        Señalización por WebSocket del DO
```

## Capas

| Capa | Responsabilidad | Archivo |
|------|-----------------|--------|
| Worker | Rutas HTTP, CORS, assets, proxy DO | `src/index.js` |
| MatchRoom | Sala, señalización, tickets, genes de evento | `src/room.js` |
| SaaSRegistry | Multi-tenant, planes, uso, pagos | `src/saas.js` |
| Genes | Identidad/ciclo de vida (no RTP) | `src/gene.js` |
| Calls | SFU opcional | `src/calls.js` |
| UI | TX / RX / director / console | `public/*` |

## Qué no se toca

- Protocolo WebSocket de señalización (`offer`/`answer`/`ice`/`program`).
- Mesh peer-to-peer entre publisher y viewer.
- Flujo publish.html / watch.html existente.

## Qué se añadió para vender

1. `POST /api/room/:id/bootstrap` + `GET .../genes` + `POST .../end` en el DO.
2. `POST /api/room/:id/ticket` y `.../ticket/check` expuestos en el Worker.
3. `/` → `index.html` (landing).
4. Registro `event-start` / `event-end` en SaaS (cupo live por plan).
5. Límite de tickets por plan al emitir.

## Despliegue

```bash
npx wrangler deploy
```

Sin migraciones nuevas de DO (mismas clases `MatchRoom` + `SaaSRegistry`).
