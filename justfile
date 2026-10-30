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
# The rig loads the helper builds from the saved copy scripts/rig-inputs.txt pins and pulls the rest.
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

# The cloud rig (docs/adr/0010): c7g.metal hosts, one per family, dispatched from GitHub Actions (.github/workflows/rig.yml)
# the way kv-stores runs its rig. Once, with AWS credentials: the stack, the role the workflow assumes, and the inputs.
rig-deploy:
    cd infra && bun x cdk deploy --require-approval never

setup-oidc:
    #!/usr/bin/env bash
    set -euo pipefail
    repo_id=$(gh api repos/warefeats/map-tile-servers --jq .id)
    aws cloudformation deploy --template-file infra/github-oidc-role.yml --stack-name map-tile-servers-github-oidc \
        --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset \
        --parameter-overrides RepositoryId="$repo_id" OidcProviderArn=arn:aws:iam::{{aws_account}}:oidc-provider/token.actions.githubusercontent.com
    role=$(aws cloudformation describe-stacks --stack-name map-tile-servers-github-oidc --query "Stacks[0].Outputs[?OutputKey=='RoleArn'].OutputValue" --output text)
    gh secret set AWS_ROLE_ARN --repo warefeats/map-tile-servers --body "$role"
    echo "AWS_ROLE_ARN is $role"

# Upload the inputs scripts/rig-inputs.txt pins (IMAGES and DBDATA name the saved helper images and database volume).
rig-inputs:
    bash scripts/rig-inputs.sh

# Offline preflight; run it before every dispatch.
rig-walk:
    bash scripts/rig-walk.sh

# A dispatch. smoke runs each family's smoke (the PostGIS host builds Martin 2.0 when the bucket lacks it), full runs
# both passes and the verdict, collect scores a run whose host outlived its job (add -f run_id=<run>).
rig-cloud MODE="smoke" FAMILIES="both" *ARGS:
    gh workflow run rig.yml --repo warefeats/map-tile-servers -f mode={{MODE}} -f families={{FAMILIES}} {{ARGS}}

rig-watch:
    gh run list --repo warefeats/map-tile-servers --workflow=rig.yml --limit=1 --json databaseId --jq '.[0].databaseId' | xargs gh run watch --repo warefeats/map-tile-servers

# One dispatch's artifacts: results and the verdict into the repo, all of it (logs, the build record) in .work/rig/gh-<id>/.
# the archive lane's JSON records and report of a lane.yml run into runs/lane/<date>-<id>/ (logs stay in the artifact)
lane-fetch ID:
    #!/usr/bin/env bash
    set -euo pipefail
    tmp=$(mktemp -d)
    gh run download {{ID}} --repo warefeats/map-tile-servers --dir "$tmp"
    src="$tmp/lane-{{ID}}"
    [ -f "$src/plan.json" ] || { echo "run {{ID}} has no lane records" >&2; exit 1; }
    dst="runs/lane/$(jq -r '.startedAt[0:10]' "$src/plan.json")-{{ID}}"
    rm -rf "$dst"
    mkdir -p "$dst"
    rsync -a --prune-empty-dirs --exclude 'ssm/' --include '*/' --include '*.json' --include '*.md' --include 'samples.log' --exclude '*' "$src/" "$dst/"
    rm -rf "$tmp"
    echo "$dst: $(find "$dst" -type f | wc -l) files, $(du -sh "$dst" | cut -f1)"

rig-fetch ID:
    #!/usr/bin/env bash
    set -euo pipefail
    dir=.work/rig/gh-{{ID}}
    rm -rf "$dir"
    gh run download {{ID}} --repo warefeats/map-tile-servers --dir "$dir"
    find "$dir" -type f \( -name 'results-*.json' -o -name 'verdict-*' \) -exec cp {} . \;
    ls -R "$dir"

rig-destroy:
    cd infra && bun x cdk destroy --force
