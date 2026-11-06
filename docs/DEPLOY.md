# Deploying to Railway

1. Push the repo to GitHub, then create a Railway project from it. Choose a US East region.
2. Add a **volume** to the service, mounted at `/data`.
3. Set variables on the service:
   - `OPS_TOKEN`: a long random string
4. Generate a public domain under Networking.
5. Check these settings. `railway.json` sets them, but Railway has deprecated that file, so confirm them in the dashboard:
   - Builder: Dockerfile
   - Healthcheck path: `/healthz`
   - Restart policy: On failure

The service must stay at one replica, because a volume attaches to a single instance.

## After the first deploy

Run the smoke and abuse tests against the live URL:

```bash
npx tsx scripts/smoke.ts https://your-app.up.railway.app
```

```bash
npx tsx scripts/abuse.ts https://your-app.up.railway.app
```

The Docker image has been tested on Linux, including volume persistence and SIGTERM, but not on Railway. Check these by hand:

- [ ] `/ops` updates live. If numbers only appear in bursts, Railway's proxy is buffering the SSE stream.
- [ ] Play a round, redeploy, and confirm the leaderboard kept its data. This proves the volume.
- [ ] Spawn Swarm holds at 25, then raise `SWARM_MAX` and find the hosted ceiling. Record it in `ARCHITECTURE.md`.

## During judging

Every deploy restarts the service and ends live rounds, so freeze deploys before demos.

Keep the service running until winners are posted on November 13.
