#!/bin/bash
cd ~/work/pr-164796-m5 || exit 1
export PATH=$HOME/homebrew/bin:$PATH
G=.m5/gates
pnpm install --frozen-lockfile > $G/install.log 2>&1; echo "install exit=$?" > $G/setup.txt
git diff --cached --stat -- docs/.generated > $G/pre-gen-baseline.txt
pnpm config:docs:check > $G/pre-config-docs-check.log 2>&1; echo "pre config:docs:check exit=$?" >> $G/setup.txt
pnpm config:docs:gen > $G/config-docs-gen.log 2>&1; echo "config:docs:gen exit=$?" >> $G/setup.txt
pnpm config:docs:check > $G/config-docs-check.log 2>&1; echo "config:docs:check exit=$?" >> $G/setup.txt
git status --short -- docs/.generated >> $G/setup.txt
echo done > $G/setup.done
