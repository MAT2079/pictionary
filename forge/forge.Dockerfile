# Forge (AUTOMATIC1111 fork) with --api, GPU-enabled, for the Windows compose
# stack (spec §16). Used only if you don't substitute a trusted prebuilt image.
#
# This builds a CUDA runtime base, clones Forge, and prepares a venv. Models are
# NOT baked in — they are volume-mounted from ./models at runtime.

FROM nvidia/cuda:12.1.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    git python3 python3-venv python3-pip libgl1 libglib2.0-0 google-perftools \
    curl bash ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Pin to the Forge repo. (Forge moved orgs over time; adjust the URL if needed.)
RUN git clone --depth 1 https://github.com/lllyasviel/stable-diffusion-webui-forge.git /app

# Pre-create model dirs that the compose file mounts over.
RUN mkdir -p /app/models/Stable-diffusion /app/models/Lora /app/models/VAE /app/outputs

# Forge bootstraps its own venv + torch on first launch via launch.py. We let it
# do that at container start so the CUDA wheels match the runtime.
ENV COMMANDLINE_ARGS="--api --listen --port 7860 --xformers"

EXPOSE 7860

# `--api` exposes /sdapi/v1/*; `--listen` binds 0.0.0.0 *inside the container*
# only (the compose network is private; nothing is published publicly).
CMD ["bash", "-lc", "python3 launch.py ${COMMANDLINE_ARGS}"]
