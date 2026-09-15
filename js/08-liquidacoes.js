function rotuloOrigemLiquidacao(origem) {
            const mapa = {
                manual: 'Pagamento/recebimento manual',
                fatura: 'Pagamento da fatura',
                cadastro: 'Lançamento criado como liquidado',
                ajuste: 'Ajuste do lançamento',
                saldo_inicial: 'Saldo existente antes do histórico',
                estorno_manual: 'Estorno manual'
            };

            return mapa[origem] || 'Movimentação financeira';
        }

        function formatarDataHoraBR(valor) {
            if (!valor) return '';

            try {
                return new Intl.DateTimeFormat('pt-BR', {
                    dateStyle: 'short',
                    timeStyle: 'short'
                }).format(new Date(valor));
            } catch {
                return String(valor);
            }
        }

        async function buscarHistoricoLiquidacao(transacaoId) {
            const [transacaoResult, movimentosResult] = await Promise.all([
                supabaseClient
                    .from('transacoes')
                    .select('id,descricao,valor,valor_pago,tipo,status,conta_id')
                    .eq('id', transacaoId)
                    .eq('user_id', usuarioAtual.id)
                    .single(),

                supabaseClient
                    .from('liquidacoes')
                    .select('id,transacao_id,conta_id,valor,tipo,origem,liquidacao_origem_id,created_at')
                    .eq('transacao_id', transacaoId)
                    .eq('user_id', usuarioAtual.id)
                    .order('created_at', { ascending: false })
                    .order('id', { ascending: false })
            ]);

            if (transacaoResult.error) throw transacaoResult.error;
            if (movimentosResult.error) throw movimentosResult.error;

            return {
                transacao: transacaoResult.data,
                movimentos: movimentosResult.data || []
            };
        }

        async function abrirHistoricoLiquidacao(transacaoId) {
            if (!usuarioAtual || carregandoHistoricoLiquidacao) return;

            const modal = document.getElementById('payment-history-modal');
            const lista = document.getElementById('payment-history-list');

            transacaoHistoricoLiquidacaoAtual = Number(transacaoId);

            modal.classList.add('open');
            document.body.style.overflow = 'hidden';

            lista.innerHTML =
                '<div class="payment-history-empty">Carregando histórico...</div>';

            await renderizarHistoricoLiquidacao(transacaoId);
        }

        async function atualizarHistoricoLiquidacaoAberto() {
            const modal = document.getElementById('payment-history-modal');

            if (
                !modal ||
                !modal.classList.contains('open') ||
                !transacaoHistoricoLiquidacaoAtual
            ) {
                return;
            }

            await renderizarHistoricoLiquidacao(
                transacaoHistoricoLiquidacaoAtual,
                true
            );
        }

        async function renderizarHistoricoLiquidacao(transacaoId, silencioso = false) {
            if (!usuarioAtual || carregandoHistoricoLiquidacao) return;

            carregandoHistoricoLiquidacao = true;

            try {
                const { transacao, movimentos } =
                    await buscarHistoricoLiquidacao(transacaoId);

                if (
                    Number(transacaoHistoricoLiquidacaoAtual) !==
                    Number(transacaoId)
                ) {
                    return;
                }

                const total = Number(transacao.valor || 0);
                const liquidado = Math.max(
                    0,
                    Math.min(total, Number(transacao.valor_pago || 0))
                );
                const restante = Math.max(0, total - liquidado);

                document.getElementById('payment-history-title').textContent =
                    `🧾 ${transacao.descricao || 'Histórico financeiro'}`;

                document.getElementById('payment-history-subtitle').textContent =
                    transacao.tipo === 'entrada'
                        ? 'Recebimentos e estornos deste lançamento.'
                        : 'Pagamentos e estornos deste lançamento.';

                document.getElementById('history-total').textContent =
                    formatarMoeda(total);

                document.getElementById('history-liquidated-label').textContent =
                    transacao.tipo === 'entrada' ? 'Recebido' : 'Pago';

                document.getElementById('history-liquidated').textContent =
                    formatarMoeda(liquidado);

                document.getElementById('history-remaining').textContent =
                    formatarMoeda(restante);

                const lista = document.getElementById('payment-history-list');

                if (!movimentos.length) {
                    lista.innerHTML =
                        '<div class="payment-history-empty">Nenhum pagamento/recebimento registrado ainda.</div>';
                    return;
                }

                // Soma os estornos vinculados a cada liquidação original.
                const estornadoPorLiquidacao = new Map();

                movimentos
                    .filter(m =>
                        m.tipo === 'estorno' &&
                        m.liquidacao_origem_id
                    )
                    .forEach(m => {
                        const chave = String(m.liquidacao_origem_id);
                        estornadoPorLiquidacao.set(
                            chave,
                            (estornadoPorLiquidacao.get(chave) || 0) +
                            Number(m.valor || 0)
                        );
                    });

                lista.innerHTML = movimentos
                    .map(m => {
                        const valor = Number(m.valor || 0);
                        const positivo = m.tipo === 'liquidacao';
                        const sinal = positivo ? '+' : '-';

                        let complemento = '';
                        let botaoEstorno = '';

                        if (positivo) {
                            const totalEstornado = Math.min(
                                valor,
                                Number(
                                    estornadoPorLiquidacao.get(String(m.id)) || 0
                                )
                            );

                            const aindaEstornavel = Math.max(
                                0,
                                valor - totalEstornado
                            );

                            if (totalEstornado > 0) {
                                complemento =
                                    ` • Estornado: ${formatarMoeda(totalEstornado)}`;
                            }

                            if (
                                aindaEstornavel > 0.005 &&
                                liquidado > 0.005
                            ) {
                                botaoEstorno = `
                                    <button
                                        class="btn-reversal"
                                        onclick="estornarLiquidacao(${Number(m.id)})"
                                    >
                                        ↩ Estornar
                                    </button>
                                `;
                            }
                        }

                        const titulo =
                            positivo
                                ? (
                                    transacao.tipo === 'entrada'
                                        ? 'Recebimento'
                                        : 'Pagamento'
                                )
                                : 'Estorno';

                        const contaMovimento =
                            m.conta_id
                                ? obterContaPorId(m.conta_id)
                                : null;

                        const detalheConta =
                            contaMovimento
                                ? ` • 🏦 ${escaparHTML(contaMovimento.nome)}`
                                : ' • Sem conta vinculada';

                        return `
                            <div class="payment-move">
                                <div>
                                    <div class="payment-move-title">
                                        ${titulo}
                                    </div>
                                    <div class="payment-move-meta">
                                        ${formatarDataHoraBR(m.created_at)}
                                        • ${rotuloOrigemLiquidacao(m.origem)}
                                        ${detalheConta}
                                        ${complemento}
                                    </div>
                                </div>

                                <div class="payment-move-value ${positivo ? 'positive' : 'negative'}">
                                    <strong>${sinal} ${formatarMoeda(valor)}</strong>
                                    ${botaoEstorno}
                                </div>
                            </div>
                        `;
                    })
                    .join('');

            } catch (err) {
                console.error('Erro ao carregar histórico financeiro:', err);

                const lista = document.getElementById('payment-history-list');

                if (lista) {
                    lista.innerHTML =
                        '<div class="payment-history-empty">Não foi possível carregar o histórico.</div>';
                }

                if (!silencioso) {
                    showToast('Não foi possível carregar o histórico financeiro.');
                }
            } finally {
                carregandoHistoricoLiquidacao = false;
            }
        }

        function fecharHistoricoLiquidacao(event = null) {
            if (
                event &&
                event.target &&
                event.target.id !== 'payment-history-modal'
            ) {
                return;
            }

            const modal = document.getElementById('payment-history-modal');

            if (modal) {
                modal.classList.remove('open');
            }

            document.body.style.overflow = '';
            transacaoHistoricoLiquidacaoAtual = null;
        }

        async function estornarLiquidacao(liquidacaoId) {
            if (!usuarioAtual) {
                showToast('Sua sessão expirou. Entre novamente.');
                return;
            }

            if (!confirm(
                'Deseja estornar este pagamento/recebimento?\n\n' +
                'O valor voltará a ficar pendente no lançamento.'
            )) {
                return;
            }

            try {
                const { data, error } = await supabaseClient
                    .rpc('estornar_liquidacao', {
                        p_liquidacao_id: Number(liquidacaoId)
                    });

                if (error) throw error;

                const valorEstornado = Number(data || 0);

                await Promise.all([
                    carregarDados(),
                    carregarCartoesFaturas(),
                    carregarContasCarteiras(),
                    atualizarHistoricoLiquidacaoAberto()
                ]);

                showToast(
                    valorEstornado > 0
                        ? `Estorno realizado: ${formatarMoeda(valorEstornado)}`
                        : 'Nada havia para estornar.'
                );
            } catch (err) {
                console.error('Erro ao estornar liquidação:', err);

                const msg = String(err?.message || '');

                if (msg.includes('LIQUIDACAO_JA_ESTORNADA')) {
                    showToast('Este pagamento/recebimento já foi totalmente estornado.');
                } else if (msg.includes('LIQUIDACAO_NAO_ENCONTRADA')) {
                    showToast('Pagamento/recebimento não encontrado.');
                } else if (msg.includes('SEM_SALDO_PARA_ESTORNAR')) {
                    showToast('Este lançamento não possui saldo liquidado para estornar.');
                } else {
                    showToast('Não foi possível realizar o estorno.');
                }
            }
        }

        function normalizarValorDigitado(valor) {
            const texto = String(valor ?? '').trim();

            if (!texto) return NaN;

            if (texto.includes(',')) {
                return Number(
                    texto
                        .replace(/\./g, '')
                        .replace(',', '.')
                );
            }

            return Number(texto);
        }

        async function registrarLiquidacao(id, tipo = 'saida') {
            if (!usuarioAtual) {
                showToast("Sua sessão expirou. Entre novamente.");
                return;
            }

            try {
                const { data: registro, error: consultaError } = await supabaseClient
                    .from('transacoes')
                    .select('id,descricao,valor,valor_pago,tipo,status')
                    .eq('id', id)
                    .eq('user_id', usuarioAtual.id)
                    .single();

                if (consultaError) throw consultaError;

                const total = Number(registro.valor || 0);
                const jaLiquidado = Math.max(
                    0,
                    Math.min(total, Number(registro.valor_pago || 0))
                );
                const restante = Math.max(0, total - jaLiquidado);

                if (restante <= 0) {
                    showToast(
                        tipo === 'entrada'
                            ? "Esta entrada já foi recebida por completo."
                            : "Esta conta já foi paga por completo."
                    );
                    return;
                }

                const verbo = tipo === 'entrada' ? 'receber' : 'pagar';

                const contaMovimento =
                    await selecionarContaParaMovimento(
                        tipo === 'entrada'
                            ? 'Em qual conta o dinheiro entrou?'
                            : 'De qual conta saiu este pagamento?',
                        registro.conta_id
                    );

                if (!contaMovimento) return;

                const informado = prompt(
                    `${registro.descricao}\n\n` +
                    `Valor total: ${formatarMoeda(total)}\n` +
                    `${tipo === 'entrada' ? 'Já recebido' : 'Já pago'}: ${formatarMoeda(jaLiquidado)}\n` +
                    `Restante: ${formatarMoeda(restante)}\n\n` +
                    `Quanto deseja ${verbo} agora?`,
                    restante.toFixed(2).replace('.', ',')
                );

                if (informado === null) return;

                const valorInformado = normalizarValorDigitado(informado);

                if (!Number.isFinite(valorInformado) || valorInformado <= 0) {
                    showToast("Digite um valor maior que zero.");
                    return;
                }

                if (valorInformado > restante + 0.001) {
                    showToast(
                        `O valor informado é maior que o restante (${formatarMoeda(restante)}).`
                    );
                    return;
                }

                const { error } = await supabaseClient
                    .rpc('registrar_liquidacao_parcial', {
                        p_transacao_id: id,
                        p_valor: Number(valorInformado.toFixed(2)),
                        p_conta_id: contaMovimento.id
                    });

                if (error) throw error;

                await Promise.all([
                    carregarDados(),
                    carregarCartoesFaturas(),
                    carregarContasCarteiras(),
                    atualizarHistoricoLiquidacaoAberto()
                ]);

                const quitou = Math.abs(valorInformado - restante) < 0.005;

                if (quitou) {
                    showToast(
                        tipo === 'entrada'
                            ? "Entrada recebida por completo!"
                            : "Conta paga por completo!"
                    );
                } else {
                    showToast(
                        `${tipo === 'entrada' ? 'Recebimento' : 'Pagamento'} parcial registrado!`
                    );
                }
            } catch (err) {
                console.error("Erro ao registrar liquidação:", err);

                const msg = String(err?.message || '');

                if (msg.includes('VALOR_MAIOR_QUE_RESTANTE')) {
                    showToast("O valor informado ficou maior que o saldo restante.");
                } else if (msg.includes('TRANSACAO_NAO_ENCONTRADA')) {
                    showToast("Lançamento não encontrado ou sem permissão.");
                } else {
                    showToast("Não foi possível registrar o pagamento/recebimento.");
                }
            }
        }

        async function deletarRegistro(id) {
            try {
                const { data: registro, error: consultaError } = await supabaseClient
                    .from('transacoes')
                    .select('id,recorrencia_id,recorrente')
                    .eq('id', id)
                    .eq('user_id', usuarioAtual.id)
                    .single();

                if (consultaError) throw consultaError;

                const mensagem = registro?.recorrencia_id
                    ? 'Excluir somente este lançamento/mês da conta fixa?\n\nA conta fixa continuará ativa nos outros meses. Para encerrar a recorrência, use o botão “Parar” em Contas Fixas Ativas.'
                    : 'Excluir este lançamento?';

                if (!confirm(mensagem)) return;

                const { error } = await supabaseClient
                    .from('transacoes')
                    .delete()
                    .eq('id', id)
                    .eq('user_id', usuarioAtual.id);

                if (error) throw error;

                if (edicaoId === id) {
                    cancelarEdicao(false);
                }

                await carregarDados();
                showToast("Registro excluído.");
            } catch (err) {
                console.error("Erro ao excluir:", err);
                showToast("Não foi possível excluir o lançamento.");
            }
        }
