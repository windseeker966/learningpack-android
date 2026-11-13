#!/bin/zsh
# 把中转服务器部署到甲骨文云（ssh 别名 oracle）：装 lp_relay.py 和 systemd 服务，放行 TCP 47322
# （服务器上的 iptables，加 OCI 子网安全列表的入站规则）。可以重复运行：已经有的不重复加。
# 用法：relay/deploy.sh
set -euo pipefail
cd "${0:A:h}"
PORT=47322
HOST=oracle

echo "== 上传并启动服务"
scp -q lp_relay.py lp-relay.service "$HOST":/tmp/
ssh "$HOST" "set -e
sudo install -D -m 644 /tmp/lp_relay.py /opt/lp-relay/lp_relay.py
sudo install -m 644 /tmp/lp-relay.service /etc/systemd/system/lp-relay.service
sudo systemctl daemon-reload
sudo systemctl enable lp-relay >/dev/null
sudo systemctl restart lp-relay
sleep 1
systemctl is-active lp-relay
curl -s http://127.0.0.1:$PORT/ping; echo
# iptables：插在 REJECT 前面，存进 /etc/iptables/rules.v4（改之前备份）
if ! sudo iptables -C INPUT -p tcp -m state --state NEW -m tcp --dport $PORT -j ACCEPT 2>/dev/null; then
  n=\$(sudo iptables -L INPUT --line-numbers -n | awk '/REJECT/ {print \$1; exit}')
  sudo cp /etc/iptables/rules.v4 /etc/iptables/rules.v4.bak-\$(date +%Y%m%d%H%M%S)
  sudo iptables -I INPUT \${n:-1} -p tcp -m state --state NEW -m tcp --dport $PORT -j ACCEPT
  sudo sh -c 'iptables-save > /etc/iptables/rules.v4'
  echo 'iptables：已放行 $PORT'
else
  echo 'iptables：已经放行过'
fi"

echo "== OCI 安全列表"
VNIC=$(ssh "$HOST" 'curl -s -m3 -H "Authorization: Bearer Oracle" http://169.254.169.254/opc/v2/vnics/' |
  python3 -c 'import sys,json; print(json.load(sys.stdin)[0]["vnicId"])')
SUBNET=$(oci network vnic get --vnic-id "$VNIC" --query 'data."subnet-id"' --raw-output)
SL=$(oci network subnet get --subnet-id "$SUBNET" --query 'data."security-list-ids"[0]' --raw-output)
RULES=$(mktemp)
oci network security-list get --security-list-id "$SL" --query 'data."ingress-security-rules"' > "$RULES"
BACKUP=~/.oci/security-list-ingress-backup-$(date +%Y%m%d%H%M%S).json
cp "$RULES" "$BACKUP"
NEW=$(python3 - "$RULES" "$PORT" <<'EOF'
import json, sys
rules = json.load(open(sys.argv[1])); port = int(sys.argv[2])
has = any(r.get('protocol') == '6' and (r.get('tcp-options') or {}).get('destination-port-range') == {'min': port, 'max': port}
          for r in rules)
if has:
    print('')
else:
    rules.append({'protocol': '6', 'source': '0.0.0.0/0', 'source-type': 'CIDR_BLOCK', 'is-stateless': False,
                  'description': 'LearningPack relay', 'tcp-options': {'destination-port-range': {'min': port, 'max': port}}})
    print(json.dumps(rules))
EOF
)
if [[ -z "$NEW" ]]; then
  echo "安全列表：已经放行过"
else
  echo "$NEW" > "$RULES"
  oci network security-list update --security-list-id "$SL" --ingress-security-rules "file://$RULES" --force >/dev/null
  echo "安全列表：已放行 TCP $PORT（改之前的规则备份在 $BACKUP）"
fi
rm -f "$RULES"

echo "== 从这里连一下"
curl -s -m 10 "http://100.114.14.67:$PORT/ping" && echo || echo "连不上（这台 Mac 要连着 Tailscale；以手机、iPad 实际同步为准）"
