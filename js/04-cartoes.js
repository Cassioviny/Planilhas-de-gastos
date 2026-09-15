function formatarMesAno(dataISO) {
            if (!dataISO) return '';
            const [ano, mes] = String(dataISO).split('-');
            return `${mes}/${ano}`;
        }

        function obterCartaoPorId(id) {
            return cartoesCache.find(c => String(c.id) === String(id)) || null;
        }

        function calcularFaturaCartao(dataCompraISO, cartao, deslocamentoParcela = 0) {
            if (!dataCompraISO || !cartao) return null;

            const [ano, mes, dia] = String(dataCompraISO).split('-').map(Number);
            const diaFechamento = Number(cartao.dia_fechamento || 1);
            const diaVencimento = Number(cartao.dia_vencimento || 1);

            // Determina em qual mês ocorre o fechamento que receberá a compra.
            let mesFechamento = new Date(ano, mes - 1, 1, 12, 0, 0);

            const fechamentoDoMes = dataMesComDia(
                mesFechamento.getFullYear(),
                mesFechamento.getMonth(),
                diaFechamento
            );

            if (dataCompraISO > fechamentoDoMes) {
                mesFechamento.setMonth(mesFechamento.getMonth() + 1);
            }

            mesFechamento.setMonth(
                mesFechamento.getMonth() + Number(deslocamentoParcela || 0)
            );

            // Se o vencimento é depois do fechamento, vence no mesmo mês.
            // Se é antes ou igual, vence no mês seguinte.
            const deslocamentoVencimento =
                diaVencimento > diaFechamento ? 0 : 1;

            const mesVencimento = new Date(
                mesFechamento.getFullYear(),
                mesFechamento.getMonth() + deslocamentoVencimento,
                1,
                12,
                0,
                0
            );

            const vencimento = dataMesComDia(
                mesVencimento.getFullYear(),
                mesVencimento.getMonth(),
                diaVencimento
            );

            return {
                vencimento,
                faturaMes: inicioMesISO(vencimento)
            };
        }

        function atualizarSelectCartoes() {
            const select = document.getElementById('cartao_id');
            if (!select) return;

            const valorAtual = select.value;
            const ativos = cartoesCache.filter(c => c.ativo !== false);

            select.innerHTML = '<option value="">Selecione um cartão</option>';

            ativos.forEach(cartao => {
                const option = document.createElement('option');
                option.value = cartao.id;
                option.textContent = cartao.nome;
                select.appendChild(option);
            });

            if (ativos.some(c => String(c.id) === String(valorAtual))) {
                select.value = valorAtual;
            }

            atualizarPreviewFatura();
        }

        function atualizarPreviewFatura() {
            const preview = document.getElementById('fatura-preview');
            if (!preview) return;

            const pagamento = document.getElementById('pagamento').value;
            const cartaoId = document.getElementById('cartao_id').value;
            const dataCompra = document.getElementById('data').value;

            if (pagamento !== 'Cartão de Crédito' || !cartaoId || !dataCompra) {
                preview.style.display = 'none';
                preview.textContent = '';
                return;
            }

            const cartao = obterCartaoPorId(cartaoId);

            if (!cartao) {
                preview.style.display = 'block';
                preview.textContent = 'Cadastre ou selecione um cartão ativo.';
                return;
            }

            const fatura = calcularFaturaCartao(dataCompra, cartao, 0);

            if (!fatura) {
                preview.style.display = 'none';
                return;
            }

            preview.style.display = 'block';
            preview.textContent =
                `1ª parcela: fatura ${formatarMesAno(fatura.faturaMes)} • vencimento ${formatarDataBR(fatura.vencimento)}`;
        }

        async function carregarTodosCartoesSupabase(incluirInativos = true) {
            if (!usuarioAtual) return [];

            let query = supabaseClient
                .from('cartoes')
                .select('*')
                .eq('user_id', usuarioAtual.id)
                .order('created_at', { ascending: true });

            if (!incluirInativos) {
                query = query.eq('ativo', true);
            }

            const { data, error } = await query;
            if (error) throw error;

            return data || [];
        }

        async function carregarCartoesFaturas() {
            if (!usuarioAtual || carregandoCartoes) return;

            carregandoCartoes = true;

            try {
                const [cartoes, transacoesResult] = await Promise.all([
                    carregarTodosCartoesSupabase(true),
                    supabaseClient
                        .from('transacoes')
                        .select('id,cartao_id,valor,valor_pago,status,fatura_mes,data')
                        .eq('user_id', usuarioAtual.id)
                        .not('cartao_id', 'is', null)
                ]);

                if (transacoesResult.error) throw transacoesResult.error;

                cartoesCache = cartoes;
                transacoesCartaoCache = transacoesResult.data || [];

                atualizarSelectCartoes();
                renderizarCartoesFaturas();
            } catch (err) {
                console.error('Erro ao carregar cartões/faturas:', err);
            } finally {
                carregandoCartoes = false;
            }
        }

        function obterResumoFatura(txFatura) {
            const total = txFatura.reduce(
                (soma, t) => soma + Number(t.valor || 0),
                0
            );

            const pago = txFatura.reduce(
                (soma, t) => soma + Math.max(
                    0,
                    Math.min(
                        Number(t.valor || 0),
                        Number(t.valor_pago || 0)
                    )
                ),
                0
            );

            const restante = Math.max(0, total - pago);

            return { total, pago, restante };
        }

        function obterStatusFatura(txFatura) {
            const { total, pago, restante } = obterResumoFatura(txFatura);

            if (total <= 0) {
                return {
                    texto: 'Sem lançamentos',
                    classe: 'invoice-status-empty'
                };
            }

            if (restante <= 0.005) {
                return {
                    texto: 'Paga',
                    classe: 'invoice-status-paid'
                };
            }

            if (pago > 0) {
                return {
                    texto: 'Parcial',
                    classe: 'invoice-status-partial'
                };
            }

            const vencimentos = txFatura
                .map(t => t.data)
                .filter(Boolean)
                .sort();

            const vencimento = vencimentos[0] || null;

            if (vencimento && vencimento < hojeStr) {
                return {
                    texto: 'Vencida',
                    classe: 'invoice-status-overdue'
                };
            }

            return {
                texto: 'Em aberto',
                classe: 'invoice-status-open'
            };
        }

        function obterFaturasDoCartao(txCartao) {
            const mapa = new Map();

            txCartao.forEach(t => {
                const mes = String(t.fatura_mes || '').substring(0, 7);
                if (!mes) return;

                if (!mapa.has(mes)) {
                    mapa.set(mes, []);
                }

                mapa.get(mes).push(t);
            });

            return [...mapa.entries()]
                .sort((a, b) => a[0].localeCompare(b[0]));
        }

        async function abrirFaturaCartao(cartaoId, mes) {
            detalhesFaturaAbertos.add(String(cartaoId));

            if (filtroMesInput.value !== mes) {
                filtroMesInput.value = mes;
                await carregarDados();
            }

            await carregarCartoesFaturas();
        }

        function toggleDetalhesFatura(cartaoId) {
            const id = String(cartaoId);

            if (detalhesFaturaAbertos.has(id)) {
                detalhesFaturaAbertos.delete(id);
            } else {
                detalhesFaturaAbertos.add(id);
            }

            renderizarCartoesFaturas();
        }

        async function pagarItemFatura(id) {
            await registrarLiquidacao(id, 'saida');
            await carregarCartoesFaturas();
        }

        function montarDetalhesFatura(txFatura, mesSelecionado) {
            if (!txFatura.length) {
                return `
                    <div class="invoice-details open">
                        <div class="cards-empty">
                            Nenhum lançamento nesta fatura.
                        </div>
                    </div>
                `;
            }

            const ordenadas = [...txFatura].sort((a, b) => {
                const dataA = a.data_compra || a.data || '';
                const dataB = b.data_compra || b.data || '';
                return dataA.localeCompare(dataB);
            });

            const { total, pago, restante } = obterResumoFatura(ordenadas);

            const linhas = ordenadas.map(t => {
                const valor = Number(t.valor || 0);
                const valorPago = Math.max(
                    0,
                    Math.min(valor, Number(t.valor_pago || 0))
                );
                const saldo = Math.max(0, valor - valorPago);

                const parcela =
                    Number(t.total_parcelas || 1) > 1
                        ? ` • ${Number(t.parcela_atual || 1)}/${Number(t.total_parcelas)}x`
                        : '';

                const situacao =
                    saldo <= 0.005
                        ? 'Pago'
                        : valorPago > 0
                            ? `Parcial • falta ${formatarMoeda(saldo)}`
                            : 'A pagar';

                return `
                    <div class="invoice-line">
                        <div class="invoice-line-main">
                            <div class="invoice-line-title">
                                ${escaparHTML(t.descricao || 'Compra')}${parcela}
                            </div>
                            <div class="invoice-line-meta">
                                Compra ${formatarDataBR(t.data_compra || t.data)}
                                • vence ${formatarDataBR(t.data)}
                                • ${situacao}
                            </div>
                        </div>

                        <div class="invoice-line-values">
                            <strong>${formatarMoeda(valor)}</strong>
                            ${
                                valorPago > 0
                                    ? `<small>Pago: ${formatarMoeda(valorPago)}</small>`
                                    : ''
                            }
                            ${
                                saldo > 0.005
                                    ? `<button class="invoice-line-pay" onclick="pagarItemFatura(${Number(t.id)})">✓ Pagar</button>`
                                    : ''
                            }
                            <button class="invoice-line-pay" onclick="abrirHistoricoLiquidacao(${Number(t.id)})">🧾 Histórico</button>
                        </div>
                    </div>
                `;
            }).join('');

            return `
                <div class="invoice-details open">
                    <div class="invoice-detail-head">
                        <strong>Itens da fatura ${mesSelecionado.split('-').reverse().join('/')}</strong>
                        <span>${ordenadas.length} lançamento(s)</span>
                    </div>

                    <div class="invoice-detail-list">
                        ${linhas}
                    </div>

                    <div class="invoice-summary">
                        <div>
                            <span>Total</span>
                            <strong>${formatarMoeda(total)}</strong>
                        </div>
                        <div>
                            <span>Já pago</span>
                            <strong>${formatarMoeda(pago)}</strong>
                        </div>
                        <div>
                            <span>Restante</span>
                            <strong>${formatarMoeda(restante)}</strong>
                        </div>
                    </div>
                </div>
            `;
        }

        function renderizarCartoesFaturas() {
            const list = document.getElementById('cards-list');
            const count = document.getElementById('cards-count');

            if (!list || !count) return;

            const ativos = cartoesCache.filter(c => c.ativo !== false);
            count.textContent = `${ativos.length} ativo(s)`;
            list.innerHTML = '';

            if (ativos.length === 0) {
                list.innerHTML =
                    '<div class="cards-empty">Nenhum cartão ativo cadastrado.</div>';
                return;
            }

            const mesSelecionado = filtroMesInput.value || mesAtual;
            const faturaMesSelecionada = `${mesSelecionado}-01`;

            ativos.forEach(cartao => {
                const txCartao = transacoesCartaoCache.filter(
                    t => String(t.cartao_id) === String(cartao.id)
                );

                const txFatura = txCartao.filter(
                    t => String(t.fatura_mes || '').substring(0, 7) === mesSelecionado
                );

                const {
                    total: totalFatura,
                    pago: pagoFatura,
                    restante: restanteFatura
                } = obterResumoFatura(txFatura);

                const statusFatura = obterStatusFatura(txFatura);
                const faturasCartao = obterFaturasDoCartao(txCartao);

                const botoesFaturas = faturasCartao
                    .slice(-8)
                    .map(([mesFatura, itens]) => {
                        const resumo = obterResumoFatura(itens);
                        const ativo = mesFatura === mesSelecionado ? 'active' : '';

                        return `
                            <button
                                class="invoice-month-btn ${ativo}"
                                onclick="abrirFaturaCartao('${cartao.id}', '${mesFatura}')"
                            >
                                ${mesFatura.split('-').reverse().join('/')}<br>
                                ${formatarMoeda(resumo.total)}
                            </button>
                        `;
                    })
                    .join('');

                const utilizado = txCartao.reduce((soma, t) => {
                    const total = Number(t.valor || 0);
                    const pago = Math.max(
                        0,
                        Math.min(total, Number(t.valor_pago || 0))
                    );
                    return soma + Math.max(0, total - pago);
                }, 0);

                const limite = Number(cartao.limite || 0);
                const disponivel = Math.max(0, limite - utilizado);
                const pct = limite > 0
                    ? Math.min(100, (utilizado / limite) * 100)
                    : 0;

                const item = document.createElement('div');
                item.className = 'credit-card-item';

                item.innerHTML = `
                    <div class="credit-card-top">
                        <div>
                            <div class="credit-card-name">💳 ${escaparHTML(cartao.nome)}</div>
                            <div class="credit-card-meta">
                                Fecha dia ${Number(cartao.dia_fechamento)} • vence dia ${Number(cartao.dia_vencimento)}
                            </div>
                        </div>

                        <div class="credit-card-actions">
                            ${
                                restanteFatura > 0
                                    ? `<button class="btn-card-action btn-card-pay" onclick="pagarFaturaCartao('${cartao.id}', '${faturaMesSelecionada}')">✓ Pagar fatura</button>`
                                    : ''
                            }
                            <button class="btn-card-action" onclick="toggleDetalhesFatura('${cartao.id}')">
                                ${detalhesFaturaAbertos.has(String(cartao.id)) ? '🙈 Ocultar fatura' : '👁 Ver fatura'}
                            </button>
                            <button class="btn-card-action" onclick="editarCartao('${cartao.id}')">✏️ Editar</button>
                            <button class="btn-card-action btn-card-stop" onclick="desativarCartao('${cartao.id}')">⏹ Desativar</button>
                        </div>
                    </div>

                    <div class="credit-card-stats">
                        <div class="credit-card-stat">
                            <span>Limite</span>
                            <strong>${formatarMoeda(limite)}</strong>
                        </div>
                        <div class="credit-card-stat">
                            <span>Disponível</span>
                            <strong>${formatarMoeda(disponivel)}</strong>
                        </div>
                        <div class="credit-card-stat">
                            <span>Fatura ${mesSelecionado.split('-').reverse().join('/')}</span>
                            <strong>${formatarMoeda(totalFatura)}</strong>
                        </div>
                        <div class="credit-card-stat">
                            <span>Restante da fatura</span>
                            <strong>${formatarMoeda(restanteFatura)}</strong>
                        </div>
                    </div>

                    <div class="credit-limit-bg">
                        <div class="credit-limit-fill" style="width:${pct}%"></div>
                    </div>

                    <div class="invoice-tools">
                        <span class="invoice-status ${statusFatura.classe}">
                            ${statusFatura.texto}
                        </span>

                        <small>
                            ${faturasCartao.length} fatura(s) com lançamento
                        </small>
                    </div>

                    ${
                        botoesFaturas
                            ? `<div class="invoice-months">${botoesFaturas}</div>`
                            : ''
                    }

                    ${
                        detalhesFaturaAbertos.has(String(cartao.id))
                            ? montarDetalhesFatura(txFatura, mesSelecionado)
                            : ''
                    }
                `;

                list.appendChild(item);
            });
        }

        async function editarCartao(cartaoId) {
            const cartao = obterCartaoPorId(cartaoId);
            if (!cartao) return;

            const nome = prompt('Nome do cartão:', cartao.nome);
            if (nome === null) return;

            const limiteTexto = prompt(
                'Limite do cartão (R$):',
                Number(cartao.limite || 0).toFixed(2).replace('.', ',')
            );
            if (limiteTexto === null) return;

            const fechamentoTexto = prompt(
                'Dia de fechamento:',
                String(cartao.dia_fechamento)
            );
            if (fechamentoTexto === null) return;

            const vencimentoTexto = prompt(
                'Dia de vencimento:',
                String(cartao.dia_vencimento)
            );
            if (vencimentoTexto === null) return;

            const limite = normalizarValorDigitado(limiteTexto);
            const fechamento = Number(fechamentoTexto);
            const vencimento = Number(vencimentoTexto);

            if (
                !nome.trim() ||
                !Number.isFinite(limite) ||
                limite <= 0 ||
                !Number.isInteger(fechamento) ||
                fechamento < 1 ||
                fechamento > 31 ||
                !Number.isInteger(vencimento) ||
                vencimento < 1 ||
                vencimento > 31
            ) {
                showToast('Confira nome, limite, fechamento e vencimento.');
                return;
            }

            try {
                const { error } = await supabaseClient
                    .from('cartoes')
                    .update({
                        nome: nome.trim(),
                        limite: Number(limite.toFixed(2)),
                        dia_fechamento: fechamento,
                        dia_vencimento: vencimento
                    })
                    .eq('id', cartaoId)
                    .eq('user_id', usuarioAtual.id);

                if (error) throw error;

                await carregarCartoesFaturas();
                showToast('Cartão atualizado!');
            } catch (err) {
                console.error('Erro ao atualizar cartão:', err);
                showToast('Não foi possível atualizar o cartão.');
            }
        }

        async function desativarCartao(cartaoId) {
            const cartao = obterCartaoPorId(cartaoId);
            if (!cartao) return;

            if (!confirm(
                `Desativar o cartão "${cartao.nome}"?\n\n` +
                'O histórico e as compras já lançadas serão mantidos.'
            )) {
                return;
            }

            try {
                const { error } = await supabaseClient
                    .from('cartoes')
                    .update({ ativo: false })
                    .eq('id', cartaoId)
                    .eq('user_id', usuarioAtual.id);

                if (error) throw error;

                await carregarCartoesFaturas();
                showToast('Cartão desativado.');
            } catch (err) {
                console.error('Erro ao desativar cartão:', err);
                showToast('Não foi possível desativar o cartão.');
            }
        }

        async function pagarFaturaCartao(cartaoId, faturaMes) {
            const cartao = obterCartaoPorId(cartaoId);
            if (!cartao) return;

            const mesLabel = formatarMesAno(faturaMes);

            const contaPagamento =
                await selecionarContaParaMovimento(
                    `De qual conta deseja pagar a fatura ${mesLabel}?`
                );

            if (!contaPagamento) return;

            if (!confirm(
                `Marcar como paga toda a fatura ${mesLabel} do cartão ${cartao.nome}?\n\n` +
                'Todos os lançamentos pendentes dessa fatura serão liquidados.'
            )) {
                return;
            }

            try {
                const { data, error } = await supabaseClient
                    .rpc('pagar_fatura_cartao', {
                        p_cartao_id: cartaoId,
                        p_fatura_mes: faturaMes,
                        p_conta_id: contaPagamento.id
                    });

                if (error) throw error;

                await Promise.all([
                    carregarDados(),
                    carregarCartoesFaturas(),
                    carregarContasCarteiras()
                ]);

                detalhesFaturaAbertos.add(String(cartaoId));
                renderizarCartoesFaturas();

                const quantidade = Number(data || 0);
                showToast(
                    quantidade > 0
                        ? `Fatura paga! ${quantidade} lançamento(s) atualizado(s).`
                        : 'A fatura já estava quitada.'
                );
            } catch (err) {
                console.error('Erro ao pagar fatura:', err);
                showToast('Não foi possível pagar a fatura.');
            }
        }

        document.getElementById('card-form').addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!usuarioAtual) return;

            const nome = document.getElementById('card-name').value.trim();
            const limite = Number(document.getElementById('card-limit').value);
            const fechamento = Number(document.getElementById('card-closing').value);
            const vencimento = Number(document.getElementById('card-due').value);

            if (
                !nome ||
                !Number.isFinite(limite) ||
                limite <= 0 ||
                !Number.isInteger(fechamento) ||
                fechamento < 1 ||
                fechamento > 31 ||
                !Number.isInteger(vencimento) ||
                vencimento < 1 ||
                vencimento > 31
            ) {
                showToast('Preencha os dados do cartão corretamente.');
                return;
            }

            try {
                const { error } = await supabaseClient
                    .from('cartoes')
                    .insert({
                        user_id: usuarioAtual.id,
                        nome,
                        limite: Number(limite.toFixed(2)),
                        dia_fechamento: fechamento,
                        dia_vencimento: vencimento,
                        ativo: true
                    });

                if (error) throw error;

                e.currentTarget.reset();
                await carregarCartoesFaturas();
                showToast('Cartão cadastrado!');
            } catch (err) {
                console.error('Erro ao cadastrar cartão:', err);
                showToast('Não foi possível cadastrar o cartão.');
            }
        });
