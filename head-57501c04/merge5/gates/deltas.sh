cd ~/work/pr-164796-m5 && N=$HOME/nas/outputs/pr-simplify/164796/merge5 && M=051bf6fa4d05e0870d0f360aee7ac1643cbb787d
git show --remerge-diff af1d1ce4a2ae > $N/diff-merge-resolution.patch; wc -l < $N/diff-merge-resolution.patch
git diff --numstat $M af1d1ce4a2ae > $N/numstat-after.txt
echo "merged vs main: $(git diff --shortstat $M af1d1ce4a2ae)"
echo "53ff5be1f3b vs 79506514289: $(git diff --shortstat 79506514289 53ff5be1f3b)"
echo "d20c06b61fb vs 79506514289: $(git diff --shortstat 79506514289 d20c06b61fb)"
diff <(git diff --numstat 79506514289 d20c06b61fb) $N/numstat-after.txt && echo "numstat identical to d20c06b61fb vs its base"
cmp <(sed -n '/^diff --git/,$p' $N/diff-merge-resolution.patch) <(sed -n '/^diff --git/,$p' ~/nas/outputs/platinum-push-2026-10-20/pr-164796/merge-resolution.remerge-diff.patch) && echo "remerge diff body identical to 0bab7cf44a7"
