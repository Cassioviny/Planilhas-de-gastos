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

            despesas.forEach(t => {
                catMap[t.categoria] =
                    (catMap[t.categoria] || 0) + Number(t.valor || 0);
            });

            const ctx = document.getElementById('categoryChart').getContext('2d');

            if (chartInstance) {
                chartInstance.destroy();
                chartInstance = null;
            }

            if (Object.keys(catMap).length === 0) return;

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
                        ]
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'right',
                            labels: {
                                boxWidth: 10,
                                font: { size: 10 }
                            }
                        }
                    }
                }
            });
        }
