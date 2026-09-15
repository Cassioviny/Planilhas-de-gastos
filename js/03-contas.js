function obterContaPorId(id) {
            return contasCache.find(
                conta => String(conta.id) === String(id)
            ) || null;
        }

        function contasAtivas() {
            return contasCache.filter(conta => conta.ativo !== false);
        }

        function atualizarSelectContas() {
            const select = document.getElementById('conta_id');
            if (!select) return;

            const valorAtual = select.value;

            select.innerHTML =
                '<option value="">Escolher quando pagar / receber</option>';

            contasAtivas().forEach(conta => {
                const option = document.createElement('option');
                option.value = conta.id;
                option.textContent =
                    `${conta.nome} • ${formatarMoeda(conta.saldoAtual)}`;
                select.appendChild(option);
            });

            if (
                contasAtivas().some(
                    conta => String(conta.id) === String(valorAtual)
                )
            ) {
                select.value = valorAtual;
            }
        }

        async function carregarTodasContasSupabase(incluirInativas = true) {
            if (!usuarioAtual) return [];

            let query = supabaseClient
                .from('contas')
                .select('*')
                .eq('user_id', usuarioAtual.id)
                .order('created_at', { ascending: true });

            if (!incluirInativas) {
                query = query.eq('ativo', true);
            }

            const { data, error } = await query;

            if (error) throw error;

            return data || [];
        }

        async function carregarContasCarteiras() {
            if (!usuarioAtual || carregandoContas) return;

            carregandoContas = true;

            try {
                const [contasResult, liquidacoesResult, transacoesResult] =
                    await Promise.all([
                        supabaseClient
                            .from('contas')
                            .select('*')
                            .eq('user_id', usuarioAtual.id)
                            .order('created_at', { ascending: true }),

                        supabaseClient
                            .from('liquidacoes')
                            .select('id,conta_id,transacao_id,valor,tipo')
                            .eq('user_id', usuarioAtual.id)
                            .not('conta_id', 'is', null),

                        supabaseClient
                            .from('transacoes')
                            .select('id,tipo')
                            .eq('user_id', usuarioAtual.id)
                    ]);

                if (contasResult.error) throw contasResult.error;
                if (liquidacoesResult.error) throw liquidacoesResult.error;
                if (transacoesResult.error) throw transacoesResult.error;

                const tipoTransacaoPorId = new Map(
                    (transacoesResult.data || []).map(
                        t => [String(t.id), t.tipo]
                    )
                );

                const movimentosPorConta = new Map();
                movimentosContasVinculados = 0;

                (liquidacoesResult.data || []).forEach(movimento => {
                    if (!movimento.conta_id) return;

                    const tipoTransacao =
                        tipoTransacaoPorId.get(String(movimento.transacao_id));

                    if (!tipoTransacao) return;

                    const valor = Number(movimento.valor || 0);

                    // Liquidação:
                    //   entrada = dinheiro entra na conta
                    //   saída   = dinheiro sai da conta
                    //
                    // Estorno faz exatamente o movimento inverso.
                    let impacto =
                        tipoTransacao === 'entrada'
                            ? valor
                            : -valor;

                    if (movimento.tipo === 'estorno') {
                        impacto *= -1;
                    }

                    const chave = String(movimento.conta_id);

                    movimentosPorConta.set(
                        chave,
                        (movimentosPorConta.get(chave) || 0) + impacto
                    );

                    movimentosContasVinculados += 1;
                });

                contasCache = (contasResult.data || []).map(conta => ({
                    ...conta,
                    saldoAtual:
                        Number(conta.saldo_inicial || 0) +
                        Number(
                            movimentosPorConta.get(String(conta.id)) || 0
                        )
                }));

                atualizarSelectContas();
                renderizarContasCarteiras();
            } catch (err) {
                console.error('Erro ao carregar contas/carteiras:', err);
            } finally {
                carregandoContas = false;
            }
        }

        function renderizarContasCarteiras() {
            const list = document.getElementById('accounts-list');
            const count = document.getElementById('accounts-count');
            const totalEl =
                document.getElementById('accounts-total-balance');
            const movimentosEl =
                document.getElementById('accounts-linked-movements');

            if (!list || !count || !totalEl || !movimentosEl) return;

            const ativas = contasAtivas();

            count.textContent = `${ativas.length} ativa(s)`;

            const saldoTotal = ativas.reduce(
                (soma, conta) =>
                    soma + Number(conta.saldoAtual || 0),
                0
            );

            totalEl.textContent = formatarMoeda(saldoTotal);
            totalEl.style.color =
                saldoTotal < 0 ? 'var(--danger)' : 'var(--primary)';

            movimentosEl.textContent =
                String(movimentosContasVinculados || 0);

            list.innerHTML = '';

            if (ativas.length === 0) {
                list.innerHTML =
                    '<div class="accounts-empty">Nenhuma conta ativa cadastrada.</div>';
                return;
            }

            ativas.forEach(conta => {
                const item = document.createElement('div');
                item.className = 'account-item';

                const saldo = Number(conta.saldoAtual || 0);

                item.innerHTML = `
                    <div>
                        <div class="account-name">
                            🏦 ${escaparHTML(conta.nome)}
                        </div>

                        <div class="account-meta">
                            ${escaparHTML(conta.tipo)}
                            • Saldo inicial ${formatarMoeda(conta.saldo_inicial)}
                        </div>
                    </div>

                    <div class="account-right">
                        <span
                            class="account-balance"
                            style="color:${saldo < 0 ? 'var(--danger)' : 'var(--primary)'}"
                        >
                            ${formatarMoeda(saldo)}
                        </span>

                        <div class="account-actions">
                            <button
                                type="button"
                                onclick="editarContaCarteira('${conta.id}')"
                            >
                                ✏️ Editar
                            </button>

                            <button
                                type="button"
                                class="danger"
                                onclick="desativarContaCarteira('${conta.id}')"
                            >
                                ⏹ Desativar
                            </button>
                        </div>
                    </div>
                `;

                list.appendChild(item);
            });
        }

        async function selecionarContaParaMovimento(
            titulo = 'Escolha a conta',
            contaPadraoId = null
        ) {
            const ativas = contasAtivas();

            if (ativas.length === 0) {
                showToast(
                    'Cadastre uma conta/carteira antes de registrar este pagamento ou recebimento.'
                );
                return null;
            }

            if (ativas.length === 1) {
                return ativas[0];
            }

            let indicePadrao = 0;

            if (contaPadraoId) {
                const encontrado = ativas.findIndex(
                    conta =>
                        String(conta.id) === String(contaPadraoId)
                );

                if (encontrado >= 0) {
                    indicePadrao = encontrado;
                }
            }

            const opcoes = ativas
                .map(
                    (conta, index) =>
                        `${index + 1} - ${conta.nome} (${formatarMoeda(conta.saldoAtual)})`
                )
                .join('\n');

            const resposta = prompt(
                `${titulo}\n\n${opcoes}\n\nDigite o número da conta:`,
                String(indicePadrao + 1)
            );

            if (resposta === null) return null;

            const indice = Number(resposta) - 1;

            if (
                !Number.isInteger(indice) ||
                indice < 0 ||
                indice >= ativas.length
            ) {
                showToast('Conta inválida.');
                return null;
            }

            return ativas[indice];
        }

        async function editarContaCarteira(contaId) {
            const conta = obterContaPorId(contaId);

            if (!conta) return;

            const nome = prompt(
                'Nome da conta/carteira:',
                conta.nome
            );

            if (nome === null) return;

            const saldoInicialTexto = prompt(
                'Saldo inicial da conta (R$):\n\n' +
                'Atenção: alterar o saldo inicial também altera o saldo atual.',
                Number(conta.saldo_inicial || 0)
                    .toFixed(2)
                    .replace('.', ',')
            );

            if (saldoInicialTexto === null) return;

            const saldoInicial =
                normalizarValorDigitado(saldoInicialTexto);

            if (
                !nome.trim() ||
                !Number.isFinite(saldoInicial)
            ) {
                showToast('Confira o nome e o saldo inicial.');
                return;
            }

            try {
                const { error } = await supabaseClient
                    .from('contas')
                    .update({
                        nome: nome.trim(),
                        saldo_inicial:
                            Number(saldoInicial.toFixed(2))
                    })
                    .eq('id', contaId)
                    .eq('user_id', usuarioAtual.id);

                if (error) throw error;

                await carregarContasCarteiras();
                showToast('Conta atualizada!');
            } catch (err) {
                console.error('Erro ao editar conta:', err);
                showToast('Não foi possível atualizar a conta.');
            }
        }

        async function desativarContaCarteira(contaId) {
            const conta = obterContaPorId(contaId);

            if (!conta) return;

            if (!confirm(
                `Desativar "${conta.nome}"?\n\n` +
                'O histórico financeiro será preservado. ' +
                'A conta deixará de aparecer para novos pagamentos.'
            )) {
                return;
            }

            try {
                const { error } = await supabaseClient
                    .from('contas')
                    .update({ ativo: false })
                    .eq('id', contaId)
                    .eq('user_id', usuarioAtual.id);

                if (error) throw error;

                await carregarContasCarteiras();
                showToast('Conta desativada.');
            } catch (err) {
                console.error('Erro ao desativar conta:', err);
                showToast('Não foi possível desativar a conta.');
            }
        }

        document
            .getElementById('account-form')
            .addEventListener('submit', async event => {
                event.preventDefault();

                if (!usuarioAtual) return;

                const nome =
                    document.getElementById('account-name').value.trim();

                const tipo =
                    document.getElementById('account-type').value;

                const saldoInicial =
                    Number(
                        document.getElementById(
                            'account-initial-balance'
                        ).value
                    );

                if (
                    !nome ||
                    !Number.isFinite(saldoInicial)
                ) {
                    showToast('Preencha os dados da conta corretamente.');
                    return;
                }

                try {
                    const { error } = await supabaseClient
                        .from('contas')
                        .insert({
                            user_id: usuarioAtual.id,
                            nome,
                            tipo,
                            saldo_inicial:
                                Number(saldoInicial.toFixed(2)),
                            ativo: true
                        });

                    if (error) throw error;

                    event.currentTarget.reset();

                    document.getElementById(
                        'account-initial-balance'
                    ).value = '0';

                    await carregarContasCarteiras();

                    showToast('Conta/carteira cadastrada!');
                } catch (err) {
                    console.error('Erro ao cadastrar conta:', err);
                    showToast('Não foi possível cadastrar a conta.');
                }
            });
