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

# Build or tag every image a run needs. Martin 2.0.0 is built from source (docs/adr/0003); see images/.
images:
    docker build -q -t wf-client:1 images/client
    docker build -q --platform linux/arm64 -t wf-martin:2.0.0-055d4ea images/martin-2.0.0
    docker build -q -f images/Dockerfile.bbox -t wf-bbox:0.6.2 images
    docker build -q -f images/Dockerfile.mbtileserver -t wf-mbtileserver:0.11.0 images
    docker pull ghcr.io/maplibre/martin:1.16.1
    docker pull gospatial/tegola:v0.21.2
    docker pull pramsey/pg_tileserv:20250131
    docker pull ghcr.io/developmentseed/tipg:1.6.1
    docker pull iide/ldproxy:4.8.1
    docker pull protomaps/go-pmtiles:v1.31.2
    docker pull versatiles/versatiles:v4.14.0
    docker pull maptiler/tileserver-gl-light:v5.6.0
    docker pull imresamu/postgis:18-3.6

# Stop every container this runner starts (the database volume is kept).
clean:
    #!/usr/bin/env bash
    set -euo pipefail
    docker ps -a --format '{{"{{"}}.Names{{"}}"}}' | grep -E '^m2-' | xargs -r docker rm -f >/dev/null || true
    echo "removed m2-* containers (volume m2-dbdata kept)"

# The cloud rig (docs/adr/0004): one dedicated Graviton host runs the whole protocol.
rig-deploy:
    cd infra && bun x cdk deploy --require-approval never

# Offline preflight; run it before every dispatch.
rig-walk:
    bash scripts/rig-walk.sh

# Upload one run's inputs: the committed tree, local images, the database volume, the archives.
rig-pack RUN IMAGE:
    bash scripts/rig-pack.sh {{RUN}} {{IMAGE}}

# Launch the instance and start the run (extra args: --smoke, --families=postgis,archive).
rig-run RUN IMAGE *ARGS:
    bash scripts/rig-run.sh {{RUN}} {{IMAGE}} {{ARGS}}

# The last lines of a run's progress log.
rig-log RUN:
    #!/usr/bin/env bash
    set -euo pipefail
    . scripts/rig-lib.sh
    aws s3 cp "s3://$(stack_output RigBucketName)/results/{{RUN}}/run.log" - | tail -n 40

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
