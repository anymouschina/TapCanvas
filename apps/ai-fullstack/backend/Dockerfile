ARG DOCKERHUB_REGISTRY=docker.1ms.run
FROM ${DOCKERHUB_REGISTRY}/library/python:3.11-slim

# Optional: override PyPI index for faster/more reliable builds (e.g. mirrors).
ARG PIP_INDEX_URL="https://pypi.org/simple"
ARG PIP_EXTRA_INDEX_URL=""
ARG PIP_TRUSTED_HOST=""

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=600 \
    # Prevent host/container inherited pip.conf from forcing an unreachable proxy.
    # (Common symptom: "ProxyError('Cannot connect to proxy', ... Connection refused)" during docker build.)
    PIP_CONFIG_FILE=/dev/null \
    # Some environments inject proxy via PIP_PROXY (pip env var) or Docker build args.
    PIP_PROXY="" \
    PIP_INDEX_URL=${PIP_INDEX_URL} \
    PIP_EXTRA_INDEX_URL=${PIP_EXTRA_INDEX_URL} \
    PIP_TRUSTED_HOST=${PIP_TRUSTED_HOST} \
    PYTHONPATH=/app/src

WORKDIR /app

COPY requirements.txt ./
COPY vendor ./vendor
COPY langgraph.json ./

# Install dependencies first for Docker layer caching (same pattern as your working `requirements.txt` project).
RUN env -i \
    PATH="/usr/local/bin:/usr/bin:/bin" \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=${PIP_DEFAULT_TIMEOUT} \
    PIP_INDEX_URL=${PIP_INDEX_URL} \
    PIP_EXTRA_INDEX_URL=${PIP_EXTRA_INDEX_URL} \
    PIP_TRUSTED_HOST=${PIP_TRUSTED_HOST} \
    /bin/sh -lc '\
      if [ -d /app/vendor/wheels ] && (find /app/vendor/wheels -maxdepth 1 -type f \( -name "*.whl" -o -name "*.tar.gz" -o -name "*.zip" \) -print -quit | grep -q .); then \
        echo "==> Using local wheelhouse (/app/vendor/wheels)"; \
        PIP_FIND_LINKS="--no-index --find-links=/app/vendor/wheels"; \
      else \
        PIP_FIND_LINKS=""; \
      fi; \
      /usr/local/bin/python -m pip --isolated install --no-cache-dir --prefer-binary --retries 20 --timeout ${PIP_DEFAULT_TIMEOUT} $PIP_FIND_LINKS -r /app/requirements.txt \
    '

COPY src ./src

EXPOSE 8080

CMD ["python", "-m", "langgraph_api.cli", "--host", "0.0.0.0", "--port", "8080", "--no-reload", "--config", "langgraph.json", "--runtime-edition", "inmem"]
