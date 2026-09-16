#!/bin/bash
set -e
certbot --nginx -d clinic.franhanel.com --non-interactive --agree-tos -m matheuspnh@gmail.com --redirect
systemctl reload nginx
echo 'SSL ativado com sucesso!'
