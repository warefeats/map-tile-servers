set dotenv-load

aws_account := env("AWS_ACCOUNT", "735853783919")
aws_region := env("AWS_REGION", "us-east-1")
export AWS_DEFAULT_REGION := aws_region
export CDK_DEFAULT_ACCOUNT := aws_account
export CDK_DEFAULT_REGION := aws_region

check:
    bun run check

test:
    bun test

# Full protocol for one family (archive | postgis); extra args pass through (e.g. --candidates=..., --resume).
bench FAMILY *ARGS:
    bun run src/run.ts --family={{FAMILY}} {{ARGS}}

smoke FAMILY *ARGS:
    bun run src/run.ts --family={{FAMILY}} --smoke {{ARGS}}

# The 1,000-source cold starts for one family.
catalog FAMILY *ARGS:
    bun run src/catalog.ts --family={{FAMILY}} {{ARGS}}

# A measured run: both families and catalogs, each candidate behind a quiet-host gate, twice (docs/adr/0005).
gated RUN:
    bash scripts/run-gated.sh {{RUN}}

# docs/adr/0001 applied to whatever results exist.
verdict *ARGS:
    bun run src/analysis.ts {{ARGS}}

import *ARGS:
    bun run src/import.ts {{ARGS}}

# Show the unpublished page on the site's dev server (never commit what this writes into the site checkout).
preview:
    bun run src/preview.ts

unpreview:
    bun run src/preview.ts --remove

# Build or tag every image a run needs but Martin 2.0, which is built from source (docs/adr/0010: on the rig, scripts/build-martin-pgo.sh).
images:
    docker build -q -t wf-client:1 images/client
    docker build -q -f images/Dockerfile.bbox -t wf-bbox:0.6.2 images
    docker build -q -f images/Dockerfile.mbtileserver -t wf-mbtileserver:0.11.0 images
    docker pull ghcr.io/maplibre/martin:1.16.1
    docker pull gospatial/tegola:v0.21.2
    docker pull pramsey/pg_tileserv:20250131
    docker pull ghcr.io/developmentseed/tipg:1.6.1
    docker pull iide/ldproxy:4.8.2
    docker pull protomaps/go-pmtiles:v1.31.2
    docker pull versatiles/versatiles:v5.4.1
    docker pull maptiler/tileserver-gl-light:v5.7.0
    docker pull imresamu/postgis:18-3.6@sha256:b5766ee720aca09c61b9a868abefbf273348a4b90ad4cf146b4f8c9ac85d48e4
    docker pull nginx@sha256:09cc2702709e6388d979d8030e3ab4eb1ceb699b2dced26d7543e872a822e823

# Stop every container this runner starts (the database volume is kept).
clean:
    #!/usr/bin/env bash
    set -euo pipefail
    docker ps -a --format '{{"{{"}}.Names{{"}}"}}' | grep -E '^m2-' | xargs -r docker rm -f >/dev/null || true
    echo "removed m2-* containers (volume m2-dbdata kept)"

# The cloud rig (docs/adr/0010): dedicated c7g.metal hosts, each running whole families of the protocol.
rig-deploy:
    cd infra && bun x cdk deploy --require-approval never

# Offline preflight; run it before every dispatch.
rig-walk:
    bash scripts/rig-walk.sh

# Upload one run's bundle: the committed tree and the inputs (local images, the database volume, the archives).
rig-pack RUN:
    bash scripts/rig-pack.sh {{RUN}}

# Launch a host and start the run on it (args: --families=postgis|archive, --build=<commit>:<rustc>, --smoke-first, --smoke, --keep).
rig-run RUN *ARGS:
    bash scripts/rig-run.sh {{RUN}} "$(bun -e "import { MARTIN_2 } from './src/matrix'; console.log(MARTIN_2.image)")" {{ARGS}}

# The last lines of one host's progress log (LABEL: postgis, archive, or postgis-archive).
rig-log RUN LABEL:
    #!/usr/bin/env bash
    set -euo pipefail
    . scripts/rig-lib.sh
    aws s3 cp "s3://$(stack_output RigBucketName)/results/{{RUN}}/run-{{LABEL}}.log" - | tail -n 40

# Copy a run's results into the repo.
rig-fetch RUN:
    bash scripts/rig-fetch.sh {{RUN}}

# Instances of any run that are still up.
rig-instances:
    #!/usr/bin/env bash
    set -euo pipefail
    . scripts/rig-lib.sh
    aws ec2 describe-instances --filters Name=tag:Project,Values=martin-2-bench Name=instance-state-name,Values=pending,running,stopping --query 'Reservations[].Instances[].[InstanceId,InstanceType,State.Name,Tags[?Key==`RunId`]|[0].Value,LaunchTime]' --output table

rig-destroy:
    cd infra && bun x cdk destroy --force
