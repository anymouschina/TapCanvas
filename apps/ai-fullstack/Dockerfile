ARG DOCKERHUB_REGISTRY=docker.1ms.run
FROM ${DOCKERHUB_REGISTRY}/langchain/langgraph-api:3.11

# Optional: override PyPI index for faster/more reliable builds (e.g. mirrors).
ARG PIP_INDEX_URL="https://pypi.org/simple"
ARG PIP_EXTRA_INDEX_URL=""
ARG PIP_TRUSTED_HOST=""

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=600 \
    # Prevent host/container inherited pip.conf from forcing an unreachable proxy.
    PIP_CONFIG_FILE=/dev/null \
    # Some environments inject proxy via PIP_PROXY (pip env var) or Docker build args.
    PIP_PROXY="" \
    PIP_INDEX_URL=${PIP_INDEX_URL} \
    PIP_EXTRA_INDEX_URL=${PIP_EXTRA_INDEX_URL} \
    PIP_TRUSTED_HOST=${PIP_TRUSTED_HOST} \
    # Make local package imports work for LANGGRAPH_HTTP app path.
    PYTHONPATH=/deps/backend/src \
    # Avoid inheriting host proxy settings (common cause of build/runtime failures).
    http_proxy= \
    https_proxy= \
    all_proxy= \
    HTTP_PROXY= \
    HTTPS_PROXY= \
    ALL_PROXY= \
    NO_PROXY=localhost,127.0.0.1

# -- Adding local package . --
ADD backend/ /deps/backend
# -- End of local package . --
ENV LANGGRAPH_HTTP='{"app": "/deps/backend/src/agent/app.py:app"}'
ENV LANGSERVE_GRAPHS='{"agent": "/deps/backend/src/agent/graph.py:graph"}'

WORKDIR /deps/backend

RUN env -i \
    PATH="/usr/local/bin:/usr/bin:/bin" \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=600 \
    PIP_CONFIG_FILE=/dev/null \
    PIP_PROXY="" \
    PIP_INDEX_URL=${PIP_INDEX_URL} \
    PIP_EXTRA_INDEX_URL=${PIP_EXTRA_INDEX_URL} \
    PIP_TRUSTED_HOST=${PIP_TRUSTED_HOST} \
    /bin/sh -lc '\
      python -m pip --version >/dev/null 2>&1 || python -m ensurepip --upgrade; \
      python -m pip install --no-cache-dir --prefer-binary --retries 20 --timeout 600 --no-index --find-links=/deps/backend/vendor/wheels -r /deps/backend/requirements.txt \
    '
