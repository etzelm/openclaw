N=$HOME/nas/outputs/pr-simplify/164796/merge5
norm(){ sed -n '/^diff --git/,$p' "$1" | sed -E 's/^([-+ ]?)(<<<<<<<|>>>>>>>) .*/\1\2 LABEL/'; }
diff <(norm $N/diff-merge-resolution.patch) <(norm ~/nas/outputs/platinum-push-2026-10-20/pr-164796/merge-resolution.remerge-diff.patch) && echo "identical except conflict-marker labels"
