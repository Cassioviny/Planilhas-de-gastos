// ============================================================
        // BANCO ONLINE - SUPABASE
        // O IndexedDB abaixo é aberto somente para migrar dados antigos.
        // Todos os novos lançamentos e configurações passam a ser salvos
        // no Supabase e ficam disponíveis em qualquer dispositivo.
        // ============================================================
        const dbLocal = new Dexie("FinanceAppDB");

        dbLocal.version(5).stores({
            transacoes: '++id, descricao, valor, data, tipo, categoria, pagamento, status, recorrente',
            configs: 'chave, valor'
        });

        let chartInstance = null;
        let carregandoDados = false;
        let recarregarDadosDepois = false;
        let carregandoRecorrencias = false;
        let gerandoRecorrencias = false;
        let carregandoCartoes = false;
        let cartoesCache = [];
        let transacoesCartaoCache = [];

        let carregandoContas = false;
        let contasCache = [];
        let movimentosContasVinculados = 0;

        const detalhesFaturaAbertos = new Set();

        let transacaoHistoricoLiquidacaoAtual = null;
        let carregandoHistoricoLiquidacao = false;

        let edicaoId = null;
        let transacaoEditando = null;

        const MESES_RECORRENCIA_FUTURA = 12;

        function dataLocalISO(data = new Date()) {
            const ano = data.getFullYear();
            const mes = String(data.getMonth() + 1).padStart(2, '0');
            const dia = String(data.getDate()).padStart(2, '0');
            return `${ano}-${mes}-${dia}`;
        }

        const hojeStr = dataLocalISO();
        document.getElementById('data').value = hojeStr;

        const mesAtual = hojeStr.substring(0, 7);
        const filtroMesInput = document.getElementById('filtro-mes');
        filtroMesInput.value = mesAtual;

        function toggleDarkMode() {
            document.body.classList.toggle('dark-mode');
            const isDark = document.body.classList.contains('dark-mode');
            localStorage.setItem('darkMode', isDark);
        }

        if (localStorage.getItem('darkMode') === 'true') {
            document.body.classList.add('dark-mode');
        }

        // ============================================================
        // PIN LOCAL DO DISPOSITIVO
        // O login principal é o Supabase. O PIN funciona apenas como uma
        // trava extra neste navegador e não é enviado ao banco.
        // ============================================================
        function chavePinLocal() {
            return usuarioAtual ? `finance_pin_${usuarioAtual.id}` : 'finance_pin_sem_usuario';
        }

        async function hashTexto(texto) {
            const dados = new TextEncoder().encode(texto);
            const hash = await crypto.subtle.digest('SHA-256', dados);
            return Array.from(new Uint8Array(hash))
                .map(byte => byte.toString(16).padStart(2, '0'))
                .join('');
        }

        async function checarPIN() {
            try {
                const pinHash = localStorage.getItem(chavePinLocal());
                if (pinHash) {
                    document.getElementById('pin-input').value = '';
                    document.getElementById('lock-screen').style.display = 'flex';
                }
            } catch (e) {
                console.error('Erro ao verificar PIN:', e);
            }
        }

        async function verificarPIN() {
            const input = document.getElementById('pin-input').value.trim();
            const pinHash = localStorage.getItem(chavePinLocal());

            if (!pinHash) {
                document.getElementById('lock-screen').style.display = 'none';
                return;
            }

            if (!/^\d{4}$/.test(input)) {
                showToast("Digite um PIN de 4 dígitos.");
                return;
            }

            const inputHash = await hashTexto(input);

            if (inputHash === pinHash) {
                document.getElementById('lock-screen').style.display = 'none';
                document.getElementById('pin-input').value = '';
                showToast("Acesso liberado!");
            } else {
                showToast("PIN incorreto!");
            }
        }

        async function configurarPIN() {
            const novoPin = prompt("Digite um PIN de 4 dígitos (ou deixe em branco para remover):");

            if (novoPin === null) return;

            const pin = novoPin.trim();

            if (pin === '') {
                localStorage.removeItem(chavePinLocal());
                document.getElementById('lock-screen').style.display = 'none';
                showToast("PIN removido deste dispositivo!");
                return;
            }

            if (!/^\d{4}$/.test(pin)) {
                showToast("O PIN deve conter exatamente 4 números.");
                return;
            }

            localStorage.setItem(chavePinLocal(), await hashTexto(pin));
            showToast("PIN configurado neste dispositivo!");
        }

        function showToast(mensagem) {
            const container = document.getElementById('toast-container');
            const toast = document.createElement('div');
            toast.className = 'toast';
            toast.innerText = mensagem;
            container.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
        }

        function solicitarNotificacoes() {
            if (!('Notification' in window)) {
                showToast("Este navegador não oferece suporte a notificações.");
                return;
            }

            Notification.requestPermission().then(perm => {
                if (perm === 'granted') showToast("Notificações ativadas com sucesso!");
                else showToast("Permissão de notificação negada.");
            });
        }

        function atualizarRotulosStatus() {
            const tipo = document.getElementById('tipo').value;
            const pagoOption = document.getElementById('status-pago-option');
            const pendenteOption = document.getElementById('status-pendente-option');
            const parcialOption = document.getElementById('status-parcial-option');

            if (!pagoOption || !pendenteOption || !parcialOption) return;

            if (tipo === 'entrada') {
                pagoOption.textContent = 'Recebido';
                pendenteOption.textContent = 'A Receber';
                parcialOption.textContent = 'Parcialmente Recebido';
            } else {
                pagoOption.textContent = 'Pago';
                pendenteOption.textContent = 'A Pagar';
                parcialOption.textContent = 'Parcialmente Pago';
            }
        }

        function toggleParcelas() {
            const pagamento = document.getElementById('pagamento').value;
            const recorrenciaSelect = document.getElementById('recorrencia');
            const tipoSelect = document.getElementById('tipo');
            const statusSelect = document.getElementById('status');
            const grupoParcelas = document.getElementById('group-parcelas');
            const grupoCartao = document.getElementById('group-cartao');
            const grupoConta = document.getElementById('group-conta');
            const contaSelect = document.getElementById('conta_id');
            const dataLabel = document.getElementById('data-label');

            const ehCartao = pagamento === 'Cartão de Crédito';

            grupoCartao.style.display = ehCartao ? 'flex' : 'none';
            grupoConta.style.display = ehCartao ? 'none' : 'flex';

            if (ehCartao && edicaoId === null) {
                contaSelect.value = '';
            }

            dataLabel.textContent = ehCartao ? 'Data da Compra' : 'Vencimento / Data';

            if (ehCartao) {
                // Compra no cartão é uma despesa que será paga pela fatura.
                tipoSelect.value = 'saida';
                tipoSelect.disabled = true;

                // Nesta versão, compras recorrentes no cartão são lançadas
                // como compras únicas/parceladas. Assinaturas no cartão
                // podem ser adicionadas em uma etapa futura.
                recorrenciaSelect.value = 'unica';
                recorrenciaSelect.disabled = true;

                if (edicaoId === null) {
                    statusSelect.value = 'Pendente';
                    statusSelect.disabled = true;
                } else {
                    statusSelect.disabled = false;
                }

                grupoParcelas.style.display =
                    edicaoId === null ? 'block' : 'none';
            } else {
                tipoSelect.disabled = false;
                statusSelect.disabled = false;

                if (!transacaoEditando?.recorrenciaId) {
                    recorrenciaSelect.disabled = false;
                }

                grupoParcelas.style.display = 'none';
            }

            atualizarRotulosStatus();
            atualizarPreviewFatura();
        }

        function formatarMoeda(v) {
            return Number(v || 0).toLocaleString('pt-BR', {
                style: 'currency',
                currency: 'BRL'
            });
        }

        function formatarDataBR(d) {
            if (!d) return '';
            const parts = d.split('-');
            return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : d;
        }

        function adicionarMesesISO(dataISO, meses) {
            const [ano, mes, dia] = dataISO.split('-').map(Number);
            const alvo = new Date(ano, (mes - 1) + meses, 1, 12, 0, 0);
            const ultimoDia = new Date(
                alvo.getFullYear(),
                alvo.getMonth() + 1,
                0,
                12,
                0,
                0
            ).getDate();

            alvo.setDate(Math.min(dia, ultimoDia));
            return dataLocalISO(alvo);
        }

        function dataMesComDia(ano, mesZeroBased, diaPreferido) {
            const primeiro = new Date(ano, mesZeroBased, 1, 12, 0, 0);
            const ultimoDia = new Date(
                primeiro.getFullYear(),
                primeiro.getMonth() + 1,
                0,
                12,
                0,
                0
            ).getDate();

            primeiro.setDate(Math.min(Number(diaPreferido || 1), ultimoDia));
            return dataLocalISO(primeiro);
        }

        function inicioMesISO(dataISO = hojeStr) {
            return `${String(dataISO).substring(0, 7)}-01`;
        }

        function inicioProximoMesISO(dataISO = hojeStr) {
            const [ano, mes] = String(dataISO).split('-').map(Number);
            return dataMesComDia(ano, mes, 1);
        }

        function mesParaDate(dataISO) {
            const [ano, mes] = String(dataISO).split('-').map(Number);
            return new Date(ano, mes - 1, 1, 12, 0, 0);
        }

        function compararMeses(dataA, dataB) {
            return String(dataA).substring(0, 7).localeCompare(String(dataB).substring(0, 7));
        }
