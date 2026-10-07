#!/bin/bash
E=~/work/oss-166304-r4
while [ ! -f "$E/chain-done.txt" ]; do sleep 20; done
bash "$E/post.sh"
