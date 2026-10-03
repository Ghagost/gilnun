#!/bin/bash
# 길눈 — 더블클릭하면 무료 Vercel에 올려서 폰·PC 어디서나 열리는 주소를 만들어요.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  # Finder starts this without your shell profile: look in the usual install places too.
  for d in /opt/homebrew/bin /usr/local/bin "$HOME/.volta/bin"; do [ -x "$d/node" ] && export PATH="$d:$PATH"; done
  [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
fi
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  길눈을 실행하려면 Node.js(무료)가 필요해요."
  echo "  방금 열린 페이지에서 LTS 버전을 설치한 뒤, 이 파일을 다시 더블클릭하세요."
  open "https://nodejs.org/ko/download"
  read -n 1 -s -r -p "  아무 키나 누르면 창이 닫혀요…"
  echo
  exit 1
fi
node scripts/deploy.mjs "$@"
code=$?
echo
read -n 1 -s -r -p "  아무 키나 누르면 창이 닫혀요…"
echo
exit $code
