
        let dashboardUltimoContexto = null;

        function formatarMesDashboard(mesAno) {
            if (!mesAno || !/^\d{4}-\d{2}$/.test(mesAno)) {
                return 'Mês selecionado';
            }

            const [ano, mes] = mesAno.split('-').map(Number);
            const data = new Date(ano, mes - 1, 1, 12, 0, 0);

            const texto = new Intl.DateTimeFormat('pt-BR', {
                month: 'long',
                year: 'numeric'
            }).format(data);

            return texto.charAt(0).toUpperCase() + texto.slice(1);
        }

        function mesAnteriorDashboard(mesAno) {
            const base = /^\d{4}-\d{2}$/.test(mesAno || '')
                ? mesAno
                : mesAtual;

            const [ano, mes] = base.split('-').map(Number);
            const data = new Date(ano, mes - 2, 1, 12, 0, 0);

            return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
        }

        function calcularFluxosDashboard(transacoes) {
            let recebido = 0;
            let aReceber = 0;
            let pago = 0;
            let aPagar = 0;

            (transacoes || []).forEach(t => {
                const valor = Number(t.valor || 0);
                const liquidado = Math.max(
                    0,
                    Math.min(valor, Number(t.valorPago || 0))
                );
                const restante = Math.max(0, valor - liquidado);

                if (t.tipo === 'entrada') {
                    recebido += liquidado;
                    aReceber += restante;
                } else {
                    pago += liquidado;
                    aPagar += restante;
                }
            });

            return {
                recebido,
                aReceber,
                pago,
                aPagar,
                saldoDisponivel: recebido - pago,
                saldoProjetado: recebido - pago + aReceber - aPagar
            };
        }

        function atualizarVariacaoDashboard(
            elementId,
            atual,
            anterior,
            maiorEhMelhor = true
        ) {
            const el = document.getElementById(elementId);
            if (!el) return;

            const diferenca = Number(atual || 0) - Number(anterior || 0);

            el.classList.remove(
                'compare-good',
                'compare-bad',
                'compare-neutral'
            );

            if (Math.abs(diferenca) < 0.005) {
                el.textContent = 'Sem mudança';
                el.classList.add('compare-neutral');
                return;
            }

            const seta = diferenca > 0 ? '↑' : '↓';

            if (Math.abs(Number(anterior || 0)) < 0.005) {
                el.textContent =
                    `${seta} ${formatarMoeda(Math.abs(diferenca))} vs. mês anterior`;
            } else {
                const pct = Math.abs(
                    (diferenca / Math.abs(anterior)) * 100
                );

                el.textContent = `${seta} ${pct.toFixed(0)}% vs. mês anterior`;
            }

            const melhorou =
                maiorEhMelhor
                    ? diferenca > 0
                    : diferenca < 0;

            el.classList.add(
                melhorou ? 'compare-good' : 'compare-bad'
            );
        }

        function atualizarResumoPatrimonialDashboard() {
            const saldoContasEl =
                document.getElementById('dashboard-accounts-balance');
            const detalheContasEl =
                document.getElementById('dashboard-accounts-detail');
            const faturasEl =
                document.getElementById('dashboard-invoices-open');
            const detalheFaturasEl =
                document.getElementById('dashboard-invoices-detail');

            if (
                !saldoContasEl ||
                !detalheContasEl ||
                !faturasEl ||
                !detalheFaturasEl
            ) {
                return;
            }

            const ativas =
                Array.isArray(contasCache)
                    ? contasCache.filter(c => c.ativo !== false)
                    : [];

            const saldoContas = ativas.reduce(
                (total, conta) =>
                    total + Number(conta.saldoAtual || 0),
                0
            );

            saldoContasEl.textContent = formatarMoeda(saldoContas);
            saldoContasEl.style.color =
                saldoContas < 0 ? 'var(--danger)' : 'var(--primary)';

            detalheContasEl.textContent =
                ativas.length > 0
                    ? `${ativas.length} conta(s)/carteira(s) ativa(s)`
                    : 'Nenhuma conta ativa';

            const mesAno =
                dashboardUltimoContexto?.mesAno ||
                filtroMesInput.value ||
                mesAtual;

            const txFaturaMes =
                Array.isArray(transacoesCartaoCache)
                    ? transacoesCartaoCache.filter(t =>
                        String(t.fatura_mes || '').substring(0, 7) === mesAno
                    )
                    : [];

            let restanteFaturas = 0;
            const cartoesComSaldo = new Set();

            txFaturaMes.forEach(t => {
                const valor = Number(t.valor || 0);
                const pago = Math.max(
                    0,
                    Math.min(valor, Number(t.valor_pago || 0))
                );
                const restante = Math.max(0, valor - pago);

                if (restante > 0.005) {
                    restanteFaturas += restante;

                    if (t.cartao_id) {
                        cartoesComSaldo.add(String(t.cartao_id));
                    }
                }
            });

            faturasEl.textContent = formatarMoeda(restanteFaturas);
            faturasEl.style.color =
                restanteFaturas > 0
                    ? 'var(--warning)'
                    : 'var(--primary)';

            detalheFaturasEl.textContent =
                cartoesComSaldo.size > 0
                    ? `${cartoesComSaldo.size} cartão(ões) com saldo no mês`
                    : 'Nenhuma fatura em aberto';
        }

        function renderizarPendenciasDashboard(transacoesDoMes) {
            const list =
                document.getElementById('dashboard-pending-list');
            const count =
                document.getElementById('dashboard-pending-count');

            if (!list || !count) return;

            const pendencias = (transacoesDoMes || [])
                .filter(t => {
                    const restante =
                        Number(t.valor || 0) -
                        Number(t.valorPago || 0);

                    return (
                        (t.status === 'Pendente' || t.status === 'Parcial') &&
                        restante > 0.005
                    );
                })
                .sort((a, b) =>
                    String(a.data || '').localeCompare(String(b.data || ''))
                );

            count.textContent = `${pendencias.length} pendência(s)`;

            if (pendencias.length === 0) {
                list.innerHTML =
                    '<div class="dashboard2-empty">Nenhuma pendência no mês.</div>';
                return;
            }

            list.innerHTML = pendencias
                .slice(0, 5)
                .map(t => {
                    const restante = Math.max(
                        0,
                        Number(t.valor || 0) -
                        Number(t.valorPago || 0)
                    );

                    const vencida =
                        t.tipo === 'saida' &&
                        t.data &&
                        t.data < hojeStr;

                    const statusTexto =
                        vencida
                            ? 'Vencida'
                            : (
                                t.tipo === 'entrada'
                                    ? 'A receber'
                                    : 'A pagar'
                            );

                    return `
                        <div class="dashboard2-list-item">
                            <div class="dashboard2-list-main">
                                <div class="dashboard2-list-title">
                                    ${escaparHTML(t.descricao || 'Lançamento')}
                                </div>
                                <div class="dashboard2-list-meta">
                                    ${formatarDataBR(t.data)}
                                    • ${escaparHTML(t.categoria || 'Outros')}
                                </div>
                            </div>

                            <div class="dashboard2-list-value">
                                <strong>${formatarMoeda(restante)}</strong>
                                <small class="${vencida ? 'overdue' : 'pending'}">
                                    ${statusTexto}
                                </small>
                            </div>
                        </div>
                    `;
                })
                .join('');
        }

        function renderizarMaioresGastosDashboard(transacoesDoMes) {
            const list =
                document.getElementById('dashboard-top-expenses');

            if (!list) return;

            const despesas = (transacoesDoMes || [])
                .filter(t => t.tipo === 'saida')
                .sort(
                    (a, b) =>
                        Number(b.valor || 0) - Number(a.valor || 0)
                )
                .slice(0, 5);

            if (despesas.length === 0) {
                list.innerHTML =
                    '<div class="dashboard2-empty">Nenhuma despesa no mês.</div>';
                return;
            }

            list.innerHTML = despesas
                .map((t, index) => `
                    <div class="dashboard2-list-item">
                        <div class="dashboard2-list-main">
                            <div class="dashboard2-list-title">
                                ${index + 1}. ${escaparHTML(t.descricao || 'Despesa')}
                            </div>
                            <div class="dashboard2-list-meta">
                                ${escaparHTML(t.categoria || 'Outros')}
                                • ${formatarDataBR(t.data)}
                            </div>
                        </div>

                        <div class="dashboard2-list-value">
                            <strong>${formatarMoeda(Number(t.valor || 0))}</strong>
                            <small class="pending">
                                ${t.status === 'Pago' ? 'Pago' : (t.status === 'Parcial' ? 'Parcial' : 'Comprometido')}
                            </small>
                        </div>
                    </div>
                `)
                .join('');
        }

        function atualizarDashboard2(contexto) {
            if (!contexto) return;

            dashboardUltimoContexto = contexto;

            const {
                todasTransacoes,
                transacoesDoMes,
                vencidasGeral,
                recebido,
                pago,
                saldoDisponivel,
                saldoProjetado,
                mesAno
            } = contexto;

            const titulo =
                document.getElementById('dashboard-month-title');

            if (titulo) {
                titulo.textContent = formatarMesDashboard(mesAno);
            }

            const health =
                document.getElementById('dashboard-health');

            if (health) {
                health.classList.remove(
                    'positive',
                    'warning',
                    'negative',
                    'neutral'
                );

                if (saldoProjetado > 0.005) {
                    health.textContent = '🟢 Projeção positiva';
                    health.classList.add('positive');
                } else if (saldoProjetado < -0.005) {
                    health.textContent = '🔴 Projeção negativa';
                    health.classList.add('negative');
                } else {
                    health.textContent = '🟡 Projeção zerada';
                    health.classList.add('warning');
                }
            }

            const overdueValue = (vencidasGeral || []).reduce(
                (total, t) =>
                    total + Math.max(
                        0,
                        Number(t.valor || 0) -
                        Number(t.valorPago || 0)
                    ),
                0
            );

            const overdueValueEl =
                document.getElementById('dashboard-overdue-value');
            const overdueDetailEl =
                document.getElementById('dashboard-overdue-detail');

            if (overdueValueEl) {
                overdueValueEl.textContent = formatarMoeda(overdueValue);
                overdueValueEl.style.color =
                    overdueValue > 0
                        ? 'var(--danger)'
                        : 'var(--primary)';
            }

            if (overdueDetailEl) {
                overdueDetailEl.textContent =
                    vencidasGeral?.length
                        ? `${vencidasGeral.length} conta(s) vencida(s) no total`
                        : 'Nenhuma conta vencida';
            }

            const mesAnterior =
                mesAnteriorDashboard(mesAno);

            const txAnterior =
                (todasTransacoes || []).filter(
                    t => t.data && t.data.startsWith(mesAnterior)
                );

            const anterior =
                calcularFluxosDashboard(txAnterior);

            const previousLabel =
                document.getElementById('dashboard-previous-month');

            if (previousLabel) {
                previousLabel.textContent =
                    formatarMesDashboard(mesAnterior);
            }

            const currentReceived =
                document.getElementById('compare-received-current');
            const currentPaid =
                document.getElementById('compare-paid-current');
            const currentResult =
                document.getElementById('compare-result-current');

            if (currentReceived) {
                currentReceived.textContent = formatarMoeda(recebido);
            }

            if (currentPaid) {
                currentPaid.textContent = formatarMoeda(pago);
            }

            if (currentResult) {
                currentResult.textContent = formatarMoeda(saldoDisponivel);
                currentResult.style.color =
                    saldoDisponivel < 0
                        ? 'var(--danger)'
                        : 'var(--primary)';
            }

            atualizarVariacaoDashboard(
                'compare-received-change',
                recebido,
                anterior.recebido,
                true
            );

            atualizarVariacaoDashboard(
                'compare-paid-change',
                pago,
                anterior.pago,
                false
            );

            atualizarVariacaoDashboard(
                'compare-result-change',
                saldoDisponivel,
                anterior.saldoDisponivel,
                true
            );

            renderizarPendenciasDashboard(transacoesDoMes);
            renderizarMaioresGastosDashboard(transacoesDoMes);
            atualizarResumoPatrimonialDashboard();
        }


function normalizarTransacaoBanco(t) {
            const valor = Number(t.valor || 0);

            const valorPago = Math.max(
                0,
                Math.min(
                    valor,
                    Number(
                        t.valor_pago ??
                        (t.status === 'Pago' ? valor : 0)
                    ) || 0
                )
            );

            let statusNormalizado = 'Pendente';

            if (valor > 0 && valorPago >= valor) {
                statusNormalizado = 'Pago';
            } else if (valorPago > 0) {
                statusNormalizado = 'Parcial';
            }

            return {
                id: t.id,
                user_id: t.user_id,
                descricao: t.descricao || '',
                valor,
                valorPago,
                data: t.data,
                tipo: t.tipo,
                status: statusNormalizado,
                categoria: t.categoria,
                pagamento: t.pagamento,
                parcelaAtual: Number(t.parcela_atual || 1),
                totalParcelas: Number(t.total_parcelas || 1),
                compraGrupoId: t.compra_grupo_id ?? null,
                contaId: t.conta_id ?? null,
                cartaoId: t.cartao_id ?? null,
                dataCompra: t.data_compra ?? null,
                faturaMes: t.fatura_mes ?? null,
                recorrente: t.recorrente || 'unica',
                recorrenciaId: t.recorrencia_id ?? null,
                geradaAutomaticamente: Boolean(t.gerada_automaticamente),
                created_at: t.created_at,
                updated_at: t.updated_at
            };
        }

        function prepararTransacaoParaBanco(t) {
            const valor = Number(t.valor || 0);

            let valorPago = Number(
                t.valor_pago ??
                t.valorPago ??
                (t.status === 'Pago' ? valor : 0)
            ) || 0;

            valorPago = Math.max(0, Math.min(valor, valorPago));

            let status;

            if (valor > 0 && valorPago >= valor) {
                status = 'Pago';
            } else if (valorPago > 0) {
                status = 'Parcial';
            } else {
                status = 'Pendente';
            }

            return {
                user_id: usuarioAtual.id,
                descricao: String(t.descricao || '').trim(),
                valor,
                valor_pago: valorPago,
                data: t.data,
                tipo: t.tipo === 'entrada' ? 'entrada' : 'saida',
                status,
                categoria: t.categoria || 'Outros',
                pagamento: t.pagamento || 'A Vista',
                parcela_atual: Number(t.parcela_atual ?? t.parcelaAtual ?? 1),
                total_parcelas: Number(t.total_parcelas ?? t.totalParcelas ?? 1),
                compra_grupo_id: t.compra_grupo_id ?? t.compraGrupoId ?? null,
                conta_id: t.conta_id ?? t.contaId ?? null,
                cartao_id: t.cartao_id ?? t.cartaoId ?? null,
                data_compra: t.data_compra ?? t.dataCompra ?? null,
                fatura_mes: t.fatura_mes ?? t.faturaMes ?? null,
                recorrente: (t.recorrente === 'fixa') ? 'fixa' : 'unica',
                recorrencia_id: t.recorrencia_id ?? t.recorrenciaId ?? null,
                gerada_automaticamente: Boolean(t.gerada_automaticamente ?? t.geradaAutomaticamente)
            };
        }

        async function carregarTodasTransacoesSupabase() {
            if (!usuarioAtual) return [];

            const pagina = 1000;
            let inicio = 0;
            let todas = [];

            while (true) {
                const { data, error } = await supabaseClient
                    .from('transacoes')
                    .select('*')
                    .order('data', { ascending: false })
                    .order('id', { ascending: false })
                    .range(inicio, inicio + pagina - 1);

                if (error) throw error;

                const lote = data || [];
                todas = todas.concat(lote);

                if (lote.length < pagina) break;
                inicio += pagina;
            }

            return todas.map(normalizarTransacaoBanco);
        }

        async function obterConfig(chave) {
            if (!usuarioAtual) return null;

            const { data, error } = await supabaseClient
                .from('configs')
                .select('valor')
                .eq('user_id', usuarioAtual.id)
                .eq('chave', chave)
                .maybeSingle();

            if (error) throw error;
            return data ? data.valor : null;
        }

        async function salvarConfig(chave, valor) {
            if (!usuarioAtual) throw new Error('Usuário não autenticado.');

            const { error } = await supabaseClient
                .from('configs')
                .upsert({
                    user_id: usuarioAtual.id,
                    chave,
                    valor
                }, {
                    onConflict: 'user_id,chave'
                });

            if (error) throw error;
        }

        async function definirMeta() {
            try {
                const metaAtual = await obterConfig('meta_mensal');
                const valorInformado = prompt(
                    "Defina seu teto de gastos mensal (R$):",
                    metaAtual !== null && metaAtual !== undefined ? String(metaAtual) : "2000"
                );

                if (valorInformado === null) return;

                const normalizado = valorInformado.trim().replace(/\./g, '').replace(',', '.');
                const valor = Number(normalizado);

                if (!Number.isFinite(valor) || valor < 0) {
                    showToast("Digite um valor válido para a meta.");
                    return;
                }

                await salvarConfig('meta_mensal', valor);
                await carregarDados();
                showToast("Meta mensal salva na nuvem!");
            } catch (err) {
                console.error("Erro ao salvar meta:", err);
                showToast("Erro ao salvar a meta.");
            }
        }

        async function carregarDados() {
            if (!usuarioAtual) return;

            if (carregandoDados) {
                recarregarDadosDepois = true;
                return;
            }

            do {
                recarregarDadosDepois = false;
                carregandoDados = true;

                try {
                const mesAno = filtroMesInput.value;
                const buscaTexto = document.getElementById('busca-texto').value.trim().toLowerCase();
                const filtroStatus = document.getElementById('filtro-status').value;

                const [todasTransacoes, metaConfig] = await Promise.all([
                    carregarTodasTransacoesSupabase(),
                    obterConfig('meta_mensal')
                ]);

                // Alertas de vencimento consideram todos os lançamentos do usuário.
                const vencidasGeral = todasTransacoes.filter(t =>
                    t.tipo === 'saida' &&
                    (t.status === 'Pendente' || t.status === 'Parcial') &&
                    t.data &&
                    t.data < hojeStr &&
                    (Number(t.valor || 0) - Number(t.valorPago || 0)) > 0
                );

                const alertVencidas = document.getElementById('alert-vencidas');

                if (vencidasGeral.length > 0) {
                    const tot = vencidasGeral.reduce(
                        (a, c) => a + Math.max(
                            0,
                            Number(c.valor || 0) - Number(c.valorPago || 0)
                        ),
                        0
                    );

                    document.getElementById('text-vencidas').innerHTML =
                        `<strong>Atenção:</strong> ${vencidasGeral.length} conta(s) VENCIDA(S) • restante ${formatarMoeda(tot)}`;
                    alertVencidas.style.display = 'flex';
                } else {
                    alertVencidas.style.display = 'none';
                }

                // O dashboard financeiro representa o mês inteiro.
                // Busca e filtro de status afetam apenas a lista, não os totais.
                let transacoesDoMes = [...todasTransacoes];

                if (mesAno) {
                    transacoesDoMes = transacoesDoMes.filter(t =>
                        t.data && t.data.startsWith(mesAno)
                    );
                }

                let recebido = 0;
                let aReceber = 0;
                let pago = 0;
                let aPagar = 0;

                transacoesDoMes.forEach(t => {
                    const valor = Number(t.valor || 0);
                    const liquidado = Math.max(
                        0,
                        Math.min(valor, Number(t.valorPago || 0))
                    );
                    const restante = Math.max(0, valor - liquidado);

                    if (t.tipo === 'entrada') {
                        recebido += liquidado;
                        aReceber += restante;
                    } else {
                        pago += liquidado;
                        aPagar += restante;
                    }
                });

                const saldoDisponivel = recebido - pago;
                const saldoProjetado = saldoDisponivel + aReceber - aPagar;

                const comprometido = transacoesDoMes
                    .filter(t => t.tipo === 'saida')
                    .reduce((total, t) => total + Number(t.valor || 0), 0);

                document.getElementById('total-recebido').innerText = formatarMoeda(recebido);
                document.getElementById('total-a-receber').innerText = formatarMoeda(aReceber);
                document.getElementById('total-pago').innerText = formatarMoeda(pago);
                document.getElementById('total-a-pagar').innerText = formatarMoeda(aPagar);

                const elDisponivel = document.getElementById('saldo-disponivel');
                elDisponivel.innerText = formatarMoeda(saldoDisponivel);
                elDisponivel.style.color =
                    saldoDisponivel < 0 ? 'var(--danger)' : 'var(--primary)';

                const elProjetado = document.getElementById('saldo-projetado');
                elProjetado.innerText = formatarMoeda(saldoProjetado);
                elProjetado.style.color =
                    saldoProjetado < 0 ? 'var(--danger)' : 'var(--text-main)';

                const metaValor = Number(metaConfig || 0);

                document.getElementById('budget-spent').innerText =
                    `Comprometido: ${formatarMoeda(comprometido)}`;

                document.getElementById('budget-target').innerText =
                    `Meta: ${formatarMoeda(metaValor)}`;

                const pct = metaValor > 0
                    ? Math.min((comprometido / metaValor) * 100, 100)
                    : 0;

                const fill = document.getElementById('budget-fill');
                fill.style.width = pct + '%';
                fill.style.backgroundColor =
                    pct >= 100
                        ? 'var(--danger)'
                        : (pct > 80 ? 'var(--warning)' : 'var(--primary)');

                atualizarDashboard2({
                    todasTransacoes,
                    transacoesDoMes,
                    vencidasGeral,
                    recebido,
                    aReceber,
                    pago,
                    aPagar,
                    saldoDisponivel,
                    saldoProjetado,
                    comprometido,
                    mesAno: mesAno || mesAtual
                });

                // Busca e status filtram somente o histórico exibido.
                let filtradas = [...transacoesDoMes];

                if (buscaTexto) {
                    filtradas = filtradas.filter(t =>
                        t.descricao &&
                        t.descricao.toLowerCase().includes(buscaTexto)
                    );
                }

                if (filtroStatus !== 'todos') {
                    if (filtroStatus === 'Vencida') {
                        filtradas = filtradas.filter(t =>
                            t.tipo === 'saida' &&
                            (t.status === 'Pendente' || t.status === 'Parcial') &&
                            t.data &&
                            t.data < hojeStr &&
                            (Number(t.valor || 0) - Number(t.valorPago || 0)) > 0
                        );
                    } else {
                        filtradas = filtradas.filter(t => t.status === filtroStatus);
                    }
                }

                renderizarLista(filtradas);

                // O gráfico mostra todos os compromissos do mês, não apenas o que
                // ficou visível após uma busca textual.
                atualizarGrafico(transacoesDoMes);
                } catch (err) {
                    console.error("Erro ao carregar dados do Supabase:", err);
                    showToast("Não foi possível carregar seus dados. Verifique a internet.");
                } finally {
                    carregandoDados = false;
                }
            } while (recarregarDadosDepois && usuarioAtual);
        }

        function renderizarLista(filtradas) {
            const listEl = document.getElementById('transaction-list');
            listEl.innerHTML = '';

            if (filtradas.length === 0) {
                listEl.innerHTML =
                    `<p style="text-align:center; color:var(--text-muted); padding:10px 0; font-size:13px;">Nenhum lançamento encontrado neste período.</p>`;
                return;
            }

            filtradas
                .sort((a, b) => {
                    const dataCmp = String(b.data || '').localeCompare(String(a.data || ''));
                    return dataCmp !== 0 ? dataCmp : Number(b.id || 0) - Number(a.id || 0);
                })
                .forEach(t => {
                    const item = document.createElement('div');
                    item.className = 'item';

                    const cor = t.tipo === 'entrada' ? 'var(--primary)' : 'var(--danger)';
                    const sinal = t.tipo === 'entrada' ? '+' : '-';

                    const valorTotal = Number(t.valor || 0);
                    const valorLiquidado = Math.max(
                        0,
                        Math.min(valorTotal, Number(t.valorPago || 0))
                    );
                    const valorRestante = Math.max(0, valorTotal - valorLiquidado);

                    let badgeStatus = '';

                    if (t.tipo === 'entrada') {
                        if (valorRestante <= 0 && valorTotal > 0) {
                            badgeStatus = `<span class="badge badge-pago">Recebido</span>`;
                        } else if (valorLiquidado > 0) {
                            badgeStatus =
                                `<span class="badge badge-parcial">Parcial • falta ${formatarMoeda(valorRestante)}</span>`;
                        } else if (t.data && t.data < hojeStr) {
                            badgeStatus = `<span class="badge badge-vencido">A Receber • Atrasado</span>`;
                        } else {
                            badgeStatus = `<span class="badge badge-pendente">A Receber</span>`;
                        }
                    } else {
                        if (valorRestante <= 0 && valorTotal > 0) {
                            badgeStatus = `<span class="badge badge-pago">Pago</span>`;
                        } else if (valorLiquidado > 0) {
                            badgeStatus =
                                `<span class="badge badge-parcial">Parcial • falta ${formatarMoeda(valorRestante)}</span>`;
                        } else if (t.data && t.data < hojeStr) {
                            badgeStatus = `<span class="badge badge-vencido">Vencida</span>`;
                        } else {
                            badgeStatus = `<span class="badge badge-pendente">A Pagar</span>`;
                        }
                    }

                    const badgeFixo =
                        t.recorrente === 'fixa'
                            ? `<span class="badge badge-fixo">Fixa</span>`
                            : '';

                    const cartao = t.cartaoId ? obterCartaoPorId(t.cartaoId) : null;
                    const conta = t.contaId ? obterContaPorId(t.contaId) : null;

                    const badgeConta =
                        conta && !t.cartaoId
                            ? `<span class="badge badge-account">🏦 ${escaparHTML(conta.nome)}</span>`
                            : '';

                    const badgeCartao =
                        t.cartaoId
                            ? `<span class="badge badge-card">💳 ${escaparHTML(cartao?.nome || 'Cartão')} • fatura ${formatarMesAno(t.faturaMes || t.data)}</span>`
                            : '';

                    const infoParc =
                        t.pagamento === 'Cartão de Crédito' && t.totalParcelas > 1
                            ? `<span class="badge badge-card">${t.parcelaAtual || 1}/${t.totalParcelas}x</span>`
                            : '';

                    const btnPagar =
                        valorRestante > 0
                            ? (
                                t.tipo === 'entrada'
                                    ? `<button class="btn-pay" onclick="registrarLiquidacao(${t.id}, 'entrada')">✓ Receber</button>`
                                    : `<button class="btn-pay" onclick="registrarLiquidacao(${t.id}, 'saida')">✓ Pagar</button>`
                            )
                            : '';

                    const detalheLiquidacao =
                        valorLiquidado > 0 && valorRestante > 0
                            ? ` • ${t.tipo === 'entrada' ? 'Recebido' : 'Pago'}: ${formatarMoeda(valorLiquidado)}`
                            : '';

                    item.innerHTML = `
                        <div class="item-info">
                            <span class="item-title">${escaparHTML(t.descricao)} ${badgeStatus} ${badgeFixo} ${badgeConta} ${badgeCartao} ${infoParc}</span>
                            <span class="item-sub">${
                                t.cartaoId
                                    ? `Compra ${formatarDataBR(t.dataCompra || t.data)} • vence ${formatarDataBR(t.data)}`
                                    : formatarDataBR(t.data)
                            } • ${escaparHTML(t.categoria)} (${escaparHTML(t.pagamento)})${detalheLiquidacao}</span>
                        </div>
                        <div class="item-actions">
                            <span class="item-value" style="color:${cor};">${sinal} ${formatarMoeda(valorTotal)}</span>
                            ${btnPagar}
                            <button class="btn-history" onclick="abrirHistoricoLiquidacao(${t.id})" title="Histórico de pagamentos/recebimentos">🧾 Histórico</button>
                            <button class="btn-edit" onclick="editarRegistro(${t.id})" title="Editar lançamento">✏️ Editar</button>
                            <button class="btn-del" onclick="deletarRegistro(${t.id})" title="Excluir lançamento">✕</button>
                        </div>
                    `;

                    listEl.appendChild(item);
                });
        }

        function escaparHTML(valor) {
            return String(valor ?? '')
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#039;');
        }

        function atualizarGrafico(transacoes) {
            const despesas = transacoes.filter(t => t.tipo === 'saida');
            const catMap = {};
            const canvas = document.getElementById('categoryChart');
            const empty = document.getElementById('category-chart-empty');

            if (!canvas) return;

            despesas.forEach(t => {
                const categoria = t.categoria || 'Outros';

                catMap[categoria] =
                    (catMap[categoria] || 0) + Number(t.valor || 0);
            });

            if (chartInstance) {
                chartInstance.destroy();
                chartInstance = null;
            }

            if (Object.keys(catMap).length === 0) {
                canvas.style.display = 'none';

                if (empty) {
                    empty.style.display = 'flex';
                }

                return;
            }

            canvas.style.display = 'block';

            if (empty) {
                empty.style.display = 'none';
            }

            const ctx = canvas.getContext('2d');

            chartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: Object.keys(catMap),
                    datasets: [{
                        data: Object.values(catMap),
                        backgroundColor: [
                            '#ef4444',
                            '#f59e0b',
                            '#3b82f6',
                            '#8b5cf6',
                            '#ec4899',
                            '#14b8a6',
                            '#64748b'
                        ],
                        borderWidth: 0,
                        hoverOffset: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '68%',
                    plugins: {
                        legend: {
                            position: 'right',
                            labels: {
                                boxWidth: 9,
                                boxHeight: 9,
                                usePointStyle: true,
                                pointStyle: 'circle',
                                padding: 10,
                                font: { size: 9 }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label(context) {
                                    return `${context.label}: ${formatarMoeda(context.raw)}`;
                                }
                            }
                        }
                    }
                }
            });
        }
