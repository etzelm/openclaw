#!/bin/bash
# usage: projects.sh <profile> : lists the synthetic claude transcripts per Claude project folder with their prompts
P=$1; cd "$P/.claude/projects" 2>/dev/null || { echo "no Claude project folders"; exit 0; }
for d in ./*; do n=${d##*-profile-}; n=${n##*-p-cli-}; for f in "$d"/*.jsonl; do echo "$n/$(basename $f): $(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).filter(j=>j.type==="user").map(j=>j.message.content);console.log(l.join(", "))' "$f")"; done; done
