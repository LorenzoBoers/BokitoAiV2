---
title: Rate limits
intro: De requestbudgetten op publieke endpoints en hoe je met 429-antwoorden omgaat.
description: Bokito-API-rate-limits per endpointgroep, het 429-antwoordformaat met Retry-After, en patronen om onder de limieten te blijven.
keywords: rate limits, 429, retry-after, throttling, quota
sort: 70
related: api-overview,api-signals,webhooks
---

# Rate limits

Publieke endpoints zijn rate-limited per client-IP over een rollend venster van 60 seconden. Limieten houden het platform responsief; normale integraties raken ze zelden.

## Limieten per endpointgroep

| Endpoints | Limiet |
| --- | --- |
| REST-API-reads (`GET /api/public/v1/...`) | 120 verzoeken/minuut |
| REST-API-writes (`POST /api/public/v1/signals`) | 30 verzoeken/minuut |
| Docs- en helpcontent (`/api/docs`, `/api/help`) | 60 verzoeken/minuut |
| Agenda inkomende triggers (`POST /api/hooks/{id}`) | 60 verzoeken/minuut |
| Websitewidget sessiestart | 30 verzoeken/minuut |

## Het 429-antwoord

Boven een limiet krijg je:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 60

{"detail": "Too many requests. Try again shortly."}
```

Respecteer `Retry-After`: pauzeer dat aantal seconden voordat je opnieuw probeert. Een retryloop die het negeert houdt het venster alleen maar vol.

## Onder de limieten blijven

- **Kies webhooks boven polling.** Een `signal.created`-[webhook](/docs/developers/webhooks) vervangt een pollingloop volledig - dit scheelt verreweg het meest.
- **Pagineer met `limit` en `offset`** in plaats van veel kleine verzoeken; reads geven tot 200 items per aanroep terug.
- **Batch pieken.** Als een upstream-systeem eventpieken produceert, zet ze in een wachtrij en verwerk in gelijkmatig tempo in plaats van elk event direct door te sturen.
- **Back-off bij 429** met de `Retry-After`-waarde plus wat jitter.

Limieten zijn per IP, dus verkeer van andere tenants raakt jouw budget niet.
