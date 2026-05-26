#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# AI Gateway Proxy - 远程下载并信任自签名证书
# 用法: ./trust-gateway.sh <网关IP> [端口]
# 示例: ./trust-gateway.sh 10.15.210.230 8082
# ============================================================

if [ $# -lt 1 ]; then
  echo "用法: $0 <网关IP> [端口]"
  echo "示例: $0 10.15.210.230 8082"
  exit 1
fi

HOST="$1"
PORT="${2:-8082}"
CERT_FILE="/tmp/ai-gateway-cert.pem"

echo "正在从 $HOST:$PORT 获取证书..."

# 通过 TLS 握手提取服务端证书（跳过验证）
CERT=$(openssl s_client -connect "${HOST}:${PORT}" -showcerts < /dev/null 2>/dev/null \
  | sed -n '/-----BEGIN CERTIFICATE-----/,/-----END CERTIFICATE-----/p' \
  | head -n 30)

if [ -z "$CERT" ]; then
  echo "获取证书失败，请确认:"
  echo "  1. 网关已启用 TLS/HTTPS"
  echo "  2. $HOST:$PORT 可以连通"
  echo "  3. 已安装 openssl"
  exit 1
fi

echo "$CERT" > "$CERT_FILE"
echo "证书已保存到 $CERT_FILE"
echo ""

# ============================================================
# 根据操作系统安装信任
# ============================================================
OS="$(uname -s)"

case "$OS" in
  Darwin)
    echo "macOS - 安装到系统钥匙串..."
    sudo security add-trusted-cert -d -r trustRoot \
      -k /Library/Keychains/System.keychain "$CERT_FILE"
    echo "证书已添加到系统钥匙串"
    ;;

  Linux)
    echo "Linux - 安装到系统 CA 列表..."
    sudo cp "$CERT_FILE" /usr/local/share/ca-certificates/ai-gateway.crt
    sudo update-ca-certificates
    echo "证书已添加到系统 CA 列表"
    ;;

  MINGW*|MSYS*|CYGWIN*)
    echo "Windows - 安装到受信任根证书颁发机构..."
    certutil -addstore Root "$CERT_FILE"
    echo "证书已添加到受信任根证书颁发机构"
    ;;

  *)
    echo "未知系统: $OS"
    echo "证书文件在: $CERT_FILE"
    echo "请手动安装信任"
    ;;
esac

echo ""
echo "完成！现在可以尝试连接:"
echo "  https://${HOST}:${PORT}/anthropic/v1/models"
