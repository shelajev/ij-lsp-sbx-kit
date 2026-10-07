# syntax=docker/dockerfile:1
# Only portable scripts reach the overlay; runtime tools belong to the workload.
FROM busybox:1.37.0 AS stage
COPY files/home/ /out/home/agent/
RUN chmod 0755 /out/home/agent/.local/bin/ij \
      /out/home/agent/.local/bin/ij-server-install \
      /out/home/agent/.local/lib/ij-lsp/daemon.js \
 && chown -R 1000:1000 /out/home/agent \
 && chown 0:0 /out /out/home

FROM scratch
COPY --from=stage /out/ /
