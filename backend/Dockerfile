FROM python:3.12-slim

LABEL org.opencontainers.image.source="https://github.com/Vennu04/BCC-CVote"
LABEL org.opencontainers.image.description="BCC-CVote Backend"

WORKDIR /app

# upgrade first — the base image's own OS packages (e.g. util-linux) can
# carry HIGH/CRITICAL CVEs newer than what's baked into the image tag,
# same reasoning as frontend/Dockerfile's `apk upgrade` step.
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
USER appuser

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

CMD ["gunicorn", "--config", "gunicorn.conf.py", "run:app"]
