# Guia de Integração: Polpes Core ↔ entregador-polpes

Este documento descreve os contratos de API, payloads, validação de webhooks com HMAC-SHA256 e o passo a passo para integrar o sistema principal (**Polpes Core**) com o módulo **entregador-polpes**.

---

## 1. Visão Geral da Arquitetura

O **entregador-polpes** funciona como um serviço independente para gestão de frota própria e rastreamento em tempo real. A comunicação é bidirecional:
1. **Core ➔ entregador-polpes (API REST)**: O Core cria entregas, consulta status e gerencia entregadores enviando o cabeçalho `X-Store-API-Key`.
2. **entregador-polpes ➔ Core (Webhooks HMAC)**: Quando o status da entrega muda (ex.: aceito, a caminho, entregue), o entregador-polpes notifica o Core com assinatura criptográfica.
3. **Painel Embutível (Iframe)**: O Core pode embutir a interface completa de gestão via `<iframe src="https://entregador.polpes.com.br/embed/painel?token=..."></iframe>`.

---

## 2. Autenticação e Credenciais

* **Header obrigatório para requisições do Core**:
  ```http
  X-Store-API-Key: epk_live_xxxxxxxxxxxxxxxxxxxxxxxx
  ```
* Cada loja possui sua própria chave de API única, com isolamento multi-tenant absoluto garantido no banco de dados.

---

## 3. Passo a Passo da Integração

### Passo 1: Provisionar a Loja (Ativação do Módulo)
Chamado uma única vez pelo Core quando a loja ativa o módulo de entregas próprias.

* **Endpoint**: `POST /api/v1/stores/provision`
* **Autenticação**: Não requer chave prévia (chamada inicial de provisionamento).
* **Payload**:
```json
{
  "core_store_id": "polpes_core_01",
  "nome": "Polpê's Açaí e Sorvetes",
  "webhook_url": "https://polpes.com.br/api/webhooks/deliveries",
  "webhook_secret": "chave_secreta_compartilhada_para_validar_hmac",
  "settings": {
    "valor_padrao_corrida": 8.0,
    "tempo_aceite_segundos": 60,
    "exigir_codigo_confirmacao": true,
    "exigir_foto": false,
    "msg_padrao_rastreio": "Seu pedido está a caminho! Acompanhe a entrega pelo link:"
  }
}
```
* **Resposta (201 Created)**:
```json
{
  "store_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "core_store_id": "polpes_core_01",
  "nome": "Polpê's Açaí e Sorvetes",
  "api_key": "epk_live_a1b2c3d4e5f6g7h8i9j0...",
  "webhook_secret": "chave_secreta_compartilhada_para_validar_hmac",
  "created": true
}
```
> **Atenção**: Guarde a `api_key` retornada nas configurações da loja no Core. Ela é exibida em texto puro apenas nesta chamada.

---

### Passo 2: Criar Entrega a partir de um Pedido
Chamado quando um pedido de delivery é confirmado no Core.

* **Endpoint**: `POST /api/v1/deliveries`
* **Headers**: `X-Store-API-Key: epk_live_...`
* **Payload**:
```json
{
  "core_order_id": "145",
  "endereco_retirada": {
    "logradouro": "Rua das Palmeiras",
    "numero": "50",
    "bairro": "Centro",
    "cidade": "Rio de Janeiro"
  },
  "endereco_entrega": {
    "logradouro": "Av. Atlântica",
    "numero": "1200",
    "complemento": "Apto 302",
    "bairro": "Copacabana",
    "cidade": "Rio de Janeiro",
    "referencia": "Em frente ao posto 4",
    "cep": "22021-001",
    "lat": -22.9711,
    "lng": -43.1822
  },
  "cliente_nome": "Maria Silva",
  "cliente_telefone": "21988887777",
  "valor_corrida": 8.0
}
```
* **Resposta (201 Created)**:
```json
{
  "delivery": {
    "id": "e3b0c442-98fc-1c14-9af0-2a3b4c5d6e7f",
    "store_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "core_order_id": "145",
    "status": "pendente",
    "codigo_confirmacao": "4821",
    "tracking_token": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "valor_corrida": 8.0,
    "criado_em": "2026-11-01T20:00:00.000Z"
  },
  "tracking_url": "https://entregador.polpes.com.br/t/a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "idempotent": false
}
```
> **Idempotência**: Se esta rota for chamada repetidamente com o mesmo `core_order_id`, o sistema devolve a mesma entrega existente com `idempotent: true` (HTTP 200), evitando pedidos duplicados.

---

### Passo 3: Enviar o Link de Rastreio ao Cliente
O Core deve incluir a `tracking_url` e o `codigo_confirmacao` de 4 dígitos na mensagem de WhatsApp/SMS do cliente:
```text
*Polpê's Açaí* — Pedido #145

Seu pedido saiu para entrega! 🛵💨
Acompanhe o entregador pelo link:
https://entregador.polpes.com.br/t/a1b2c3d4-e5f6-7890-abcd-ef1234567890

Código para liberação ao receber: *4821*
```

---

### Passo 4: Receber Webhooks no Polpes Core (Python / FastAPI)

O módulo **entregador-polpes** envia eventos para a `webhook_url` cadastrada com assinatura HMAC-SHA256 nos cabeçalhos:
- `X-Hub-Signature-256`: `sha256=<hash_hex>`
- `X-Timestamp`: `<timestamp_epoch_ms>`

#### Exemplo de implementação em Python (FastAPI):
```python
import hmac
import hashlib
import time
from fastapi import FastAPI, Request, HTTPException

app = FastAPI()

WEBHOOK_SECRET = "chave_secreta_compartilhada_para_validar_hmac"

def verify_hmac_signature(secret: str, timestamp: str, body: bytes, signature_header: str) -> bool:
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    
    received_hash = signature_header.split("sha256=")[1]
    message_to_sign = f"{timestamp}.".encode("utf-8") + body
    expected_hash = hmac.new(secret.encode("utf-8"), message_to_sign, hashlib.sha256).hexdigest()
    
    return hmac.compare_digest(received_hash, expected_hash)

@app.post("/api/webhooks/deliveries")
async def receive_delivery_webhook(request: Request):
    sig = request.headers.get("X-Hub-Signature-256", "")
    ts = request.headers.get("X-Timestamp", "")
    body = await request.body()
    
    # 1. Valida assinatura HMAC
    if not verify_hmac_signature(WEBHOOK_SECRET, ts, body, sig):
        raise HTTPException(status_code=401, detail="Assinatura inválida")
        
    # 2. Mitiga replay attack (tolerância de 5 minutos)
    try:
        if abs(time.time() * 1000 - int(ts)) > 300_000:
            raise HTTPException(status_code=400, detail="Timestamp expirado")
    except ValueError:
        raise HTTPException(status_code=400, detail="Timestamp inválido")

    payload = await request.json()
    event = payload.get("event")
    data = payload.get("data", {})
    order_id = data.get("core_order_id")

    # 3. Trata os eventos
    if event == "delivery.status_changed":
        novo_status = data.get("status")
        # ex: "aceito", "coletado", "em_rota", "cancelado"
        print(f"Pedido #{order_id} mudou para status: {novo_status}")

    elif event == "delivery.completed":
        # Pedido foi entregue com código de 4 dígitos validado!
        print(f"Pedido #{order_id} ENTREGUE com sucesso!")
        # Atualiza status no banco do Core para 'entregue'
        # e agenda disparo da pesquisa de satisfação

    return {"status": "ok"}
```

#### Eventos disparados pelo Webhook:
| Evento | Quando ocorre |
|---|---|
| `delivery.created` | Nova entrega criada no sistema |
| `delivery.assigned` | Entregador foi vinculado à corrida |
| `delivery.status_changed` | Entregador aceitou, coletou ou iniciou rota |
| `delivery.completed` | Entregador finalizou a entrega (código validado) |
| `courier.location` | Telemetria GPS em tempo real do entregador em rota |

---

### Passo 5: Painel Embutível via Iframe (Opcional)

Se o lojista preferir utilizar o painel pronto sem recriar toda a interface no Core:

1. **Gerar token de visualização**:
   - `POST /api/v1/store/embed-token` com `X-Store-API-Key`
   - Retorna `{ embed_url: "https://entregador.polpes.com.br/embed/painel?token=..." }` (válido por 2 horas).
2. **Embutir no HTML da aba "Entregas" do Core**:
   ```html
   <iframe
     src="https://entregador.polpes.com.br/embed/painel?token=SEU_TOKEN_AQUI"
     style="width: 100%; height: 90vh; border: none; border-radius: 16px;"
     allow="geolocation; camera"
   ></iframe>
   ```

A tela embutida já inclui:
- Lista de entregas com filtros e ações de atribuição.
- Cadastro de entregadores com **toggle de vínculo ativo/inativo** (se inativo, não recebe pedidos).
- Botões de convite por WhatsApp com 1 clique.
- Upload de logo personalizada da loja para o PWA (com fallback para Polpês ou Pluga).
- Configuração de valores de corrida e exigência de código de 4 dígitos.

---

## 4. Tabela Resumo de Endpoints

| Método | Endpoint | Autenticação | Descrição |
|---|---|---|---|
| `POST` | `/api/v1/stores/provision` | Pública | Ativa loja e devolve API key |
| `GET` | `/api/v1/store/settings` | `X-Store-API-Key` | Consulta configurações da loja |
| `PUT` | `/api/v1/store/settings` | `X-Store-API-Key` | Altera configurações da loja |
| `POST` | `/api/v1/store/logo` | `X-Store-API-Key` | Upload de logo personalizada (multipart) |
| `DELETE`| `/api/v1/store/logo` | `X-Store-API-Key` | Restaura logo padrão |
| `POST` | `/api/v1/store/embed-token` | `X-Store-API-Key` | Gera token para iframe |
| `GET` | `/api/v1/couriers` | `X-Store-API-Key` | Lista entregadores (`?disponiveis=true`) |
| `POST` | `/api/v1/couriers` | `X-Store-API-Key` | Cadastra entregador próprio e gera convite |
| `PATCH`| `/api/v1/couriers/:id/toggle` | `X-Store-API-Key` | Ativa/desativa vínculo do entregador |
| `POST` | `/api/v1/couriers/:id/invites` | `X-Store-API-Key` | Reenvia link de convite |
| `POST` | `/api/v1/deliveries` | `X-Store-API-Key` | Cria entrega (idempotente) |
| `GET` | `/api/v1/deliveries/:id` | `X-Store-API-Key` | Detalhes e eventos da entrega |
| `POST` | `/api/v1/deliveries/:id/assign` | `X-Store-API-Key` | Atribui entregador com toggle ativo |
| `POST` | `/api/v1/deliveries/:id/cancel` | `X-Store-API-Key` | Cancela entrega |
| `GET` | `/api/v1/tracking/:token` | Pública | Rastreio público com mapa e código 4 dígitos |
