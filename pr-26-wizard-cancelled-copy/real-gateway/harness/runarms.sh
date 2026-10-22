W=$HOME/work/pr179996-proof
for arm in before after; do
  mkdir -p $W/$arm/.proof-harness && cp $W/harness/proof.mjs $W/$arm/.proof-harness/
  cd $W/$arm
  echo "$arm HEAD $(git rev-parse HEAD) dirty=$(git status --porcelain --untracked-files=no | wc -l | tr -d ' ')" >> $W/out-heads.txt
  PROOF_SURFACES="model-setup:openai-device-code,custodian,model-setup:openrouter-oauth" node .proof-harness/proof.mjs $arm 19611 $W/out > $W/run-$arm.log 2>&1
  echo "$arm exit=$?" >> $W/runarms.status
done
