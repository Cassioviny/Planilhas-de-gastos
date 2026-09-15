async function editarRegistro(id) {
            if (!usuarioAtual) {
                showToast("Sua sessão expirou. Entre novamente.");
                return;
            }

            try {
                const { data, error } = await supabaseClient
                    .from('transacoes')
                    .select('*')
                    .eq('id', id)
                    .eq('user_id', usuarioAtual.id)
                    .single();

                if (error) throw error;

                const t = normalizarTransacaoBanco(data);

                edicaoId = t.id;
                transacaoEditando = t;

                document.getElementById('descricao').value = t.descricao;
                document.getElementById('valor').value = Number(t.valor).toFixed(2);
                document.getElementById('data').value =
                    t.cartaoId ? (t.dataCompra || t.data || hojeStr) : (t.data || hojeStr);
                document.getElementById('tipo').value = t.tipo || 'saida';

                document.getElementById('status').value = t.status || 'Pendente';

                document.getElementById('pagamento').value = t.pagamento || 'A Vista';
                document.getElementById('categoria').value = t.categoria || 'Outros';

                const contaSelect = document.getElementById('conta_id');
                contaSelect.value = t.contaId || '';

                const cartaoSelect = document.getElementById('cartao_id');
                cartaoSelect.value = t.cartaoId || '';

                const recorrenciaSelect = document.getElementById('recorrencia');
                recorrenciaSelect.value = t.recorrente || 'unica';
                recorrenciaSelect.disabled = Boolean(t.recorrenciaId);

                const formCard = document.getElementById('form-card');
                const formTitle = document.getElementById('form-title');
                const submitBtn = document.getElementById('form-submit-btn');
                const cancelBtn = document.getElementById('btn-cancelar-edicao');
                const hint = document.getElementById('edit-hint');

                formCard.classList.add('editing');
                formTitle.textContent = '✏️ Editar Lançamento';
                submitBtn.textContent = 'Salvar Alterações';
                cancelBtn.style.display = 'block';

                const infoParcial =
                    t.valorPago > 0 && t.valorPago < t.valor
                        ? ` Já foi liquidado ${formatarMoeda(t.valorPago)} de ${formatarMoeda(t.valor)}.`
                        : '';

                if (t.recorrenciaId) {
                    hint.textContent =
                        'Este lançamento pertence a uma conta fixa mensal. Ao salvar, você poderá escolher ' +
                        'entre alterar somente este mês ou aplicar as mudanças também aos próximos meses.' +
                        infoParcial;
                } else if (t.cartaoId) {
                    hint.textContent =
                        `Esta compra pertence ao cartão ${obterCartaoPorId(t.cartaoId)?.nome || 'cadastrado'} e à fatura ${formatarMesAno(t.faturaMes || t.data)}. ` +
                        `A edição altera somente esta parcela/lançamento.` +
                        infoParcial;
                } else if (t.totalParcelas > 1) {
                    hint.textContent =
                        `Este lançamento é a parcela ${t.parcelaAtual}/${t.totalParcelas}. ` +
                        `A edição abaixo altera somente esta parcela; as demais continuam como estão.` +
                        infoParcial;
                } else {
                    hint.textContent =
                        'Altere os campos desejados e clique em “Salvar Alterações”.' +
                        infoParcial;
                }

                hint.style.display = 'block';
                toggleParcelas();

                // A conta de movimentos já realizados fica registrada
                // em liquidacoes. Evitamos trocar apenas o "rótulo" da
                // transação depois que já houve entrada/saída de dinheiro.
                contaSelect.disabled = Number(t.valorPago || 0) > 0 || Boolean(t.cartaoId);

                formCard.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });

                setTimeout(() => {
                    document.getElementById('descricao').focus();
                }, 350);
            } catch (err) {
                console.error("Erro ao abrir lançamento para edição:", err);
                showToast("Não foi possível carregar o lançamento para edição.");
            }
        }

        function cancelarEdicao(mostrarAviso = true) {
            const estavaEditando = edicaoId !== null;

            edicaoId = null;
            transacaoEditando = null;

            const form = document.getElementById('finance-form');
            form.reset();

            document.getElementById('data').value = hojeStr;
            document.getElementById('tipo').value = 'saida';
            document.getElementById('status').value = 'Pago';
            document.getElementById('pagamento').value = 'A Vista';
            document.getElementById('categoria').value = 'Alimentação';
            document.getElementById('conta_id').value = '';
            document.getElementById('conta_id').disabled = false;
            document.getElementById('cartao_id').value = '';
            document.getElementById('tipo').disabled = false;
            document.getElementById('status').disabled = false;
            const recorrenciaSelect = document.getElementById('recorrencia');
            recorrenciaSelect.disabled = false;
            recorrenciaSelect.value = 'unica';
            document.getElementById('parcelas').value = '1';
            atualizarRotulosStatus();

            document.getElementById('form-card').classList.remove('editing');
            document.getElementById('form-title').textContent = 'Novo Lançamento';
            document.getElementById('form-submit-btn').textContent = 'Salvar Registro';
            document.getElementById('btn-cancelar-edicao').style.display = 'none';

            const hint = document.getElementById('edit-hint');
            hint.textContent = '';
            hint.style.display = 'none';

            toggleParcelas();

            if (mostrarAviso && estavaEditando) {
                showToast("Edição cancelada.");
            }
        }

        document.getElementById('finance-form').addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!usuarioAtual) {
                showToast("Sua sessão expirou. Entre novamente.");
                return;
            }

            const submitBtn = e.currentTarget.querySelector('button[type="submit"]');
            const estavaEditando = edicaoId !== null;
            const idEmEdicao = edicaoId;

            try {
                const desc = document.getElementById('descricao').value.trim();
                const valorTotal = Number(document.getElementById('valor').value);
                const dataInput = document.getElementById('data').value;
                const tipo = document.getElementById('tipo').value;
                const status = document.getElementById('status').value;
                const pagamento = document.getElementById('pagamento').value;
                const categoria = document.getElementById('categoria').value;
                const recorrencia = document.getElementById('recorrencia').value;
                const contaIdSelecionada =
                    document.getElementById('conta_id').value || null;
                const cartaoIdSelecionado =
                    document.getElementById('cartao_id').value || null;

                if (!desc || !Number.isFinite(valorTotal) || valorTotal <= 0 || !dataInput) {
                    showToast("Preencha descrição, valor e data corretamente.");
                    return;
                }

                if (
                    pagamento !== 'Cartão de Crédito' &&
                    status === 'Pago' &&
                    !contaIdSelecionada
                ) {
                    showToast(
                        tipo === 'entrada'
                            ? 'Selecione a conta que recebeu este valor.'
                            : 'Selecione a conta usada neste pagamento.'
                    );
                    return;
                }

                if (pagamento === 'Cartão de Crédito') {
                    if (tipo !== 'saida') {
                        showToast('Compras no cartão precisam ser do tipo Saída.');
                        return;
                    }

                    if (!cartaoIdSelecionado || !obterCartaoPorId(cartaoIdSelecionado)) {
                        showToast('Selecione um cartão ativo.');
                        return;
                    }

                    if (recorrencia === 'fixa') {
                        showToast('Nesta etapa, compras no cartão devem usar Frequência Única.');
                        return;
                    }
                }

                submitBtn.disabled = true;

                // ====================================================
                // MODO EDIÇÃO
                // ====================================================
                if (estavaEditando) {
                    submitBtn.textContent = 'Salvando alterações...';

                    let dataBancoEdicao = dataInput;
                    let dataCompraBanco = null;
                    let faturaMesBanco = null;
                    let cartaoIdBanco = null;

                    if (pagamento === 'Cartão de Crédito') {
                        const cartao = obterCartaoPorId(cartaoIdSelecionado);

                        const calculoFatura = calcularFaturaCartao(
                            dataInput,
                            cartao,
                            Math.max(0, Number(transacaoEditando?.parcelaAtual || 1) - 1)
                        );

                        if (!calculoFatura) {
                            showToast('Não foi possível calcular a fatura do cartão.');
                            return;
                        }

                        dataBancoEdicao = calculoFatura.vencimento;
                        dataCompraBanco = dataInput;
                        faturaMesBanco = calculoFatura.faturaMes;
                        cartaoIdBanco = cartaoIdSelecionado;
                    }

                    const dadosEdicao = {
                        descricao: desc,
                        valor: Number(valorTotal.toFixed(2)),
                        data: dataBancoEdicao,
                        dataCompra: dataCompraBanco,
                        faturaMes: faturaMesBanco,
                        cartaoId: cartaoIdBanco,
                        contaId:
                            pagamento === 'Cartão de Crédito'
                                ? null
                                : (
                                    transacaoEditando?.valorPago > 0
                                        ? transacaoEditando?.contaId
                                        : contaIdSelecionada
                                ),
                        tipo,
                        status,
                        categoria,
                        pagamento,
                        recorrente: transacaoEditando?.recorrenciaId ? 'fixa' : recorrencia
                    };

                    let aplicarNosProximos = false;

                    if (transacaoEditando?.recorrenciaId) {
                        aplicarNosProximos = confirm(
                            'Este lançamento pertence a uma conta fixa mensal.\n\n' +
                            'OK = aplicar descrição, valor, categoria, pagamento e dia de vencimento também aos próximos meses.\n\n' +
                            'Cancelar = alterar somente este mês.'
                        );

                        if (
                            aplicarNosProximos &&
                            String(transacaoEditando.data).substring(0, 7) !== String(dataInput).substring(0, 7)
                        ) {
                            showToast('Para atualizar os próximos meses, mantenha o mesmo mês e altere apenas o dia do vencimento.');
                            return;
                        }
                    }

                    const valorJaLiquidado = Number(transacaoEditando?.valorPago || 0);

                    let novoValorPago = 0;
                    let novoStatus = dadosEdicao.status;

                    if (dadosEdicao.status === 'Pago') {
                        novoValorPago = dadosEdicao.valor;
                        novoStatus = 'Pago';
                    } else if (dadosEdicao.status === 'Pendente') {
                        // Se o usuário muda manualmente de Pago/Parcial para Pendente,
                        // desfazemos a liquidação daquele lançamento.
                        novoValorPago = 0;
                        novoStatus = 'Pendente';
                    } else {
                        // Parcial não é criado manualmente em lançamentos novos.
                        // Na edição ele apenas preserva o que já foi pago/recebido.
                        if (valorJaLiquidado <= 0) {
                            showToast(
                                "Para deixar como Parcial, registre primeiro um pagamento/recebimento parcial."
                            );
                            return;
                        }

                        if (dadosEdicao.valor <= valorJaLiquidado) {
                            showToast(
                                `O valor total deve ser maior que o já liquidado (${formatarMoeda(valorJaLiquidado)}).`
                            );
                            return;
                        }

                        novoValorPago = valorJaLiquidado;
                        novoStatus = 'Parcial';
                    }

                    const { error: atualError } = await supabaseClient
                        .from('transacoes')
                        .update({
                            descricao: dadosEdicao.descricao,
                            valor: dadosEdicao.valor,
                            valor_pago: novoValorPago,
                            data: dadosEdicao.data,
                            data_compra: dadosEdicao.dataCompra,
                            fatura_mes: dadosEdicao.faturaMes,
                            cartao_id: dadosEdicao.cartaoId,
                            conta_id: dadosEdicao.contaId,
                            tipo: dadosEdicao.tipo,
                            status: novoStatus,
                            categoria: dadosEdicao.categoria,
                            pagamento: dadosEdicao.pagamento,
                            recorrente: dadosEdicao.recorrente
                        })
                        .eq('id', idEmEdicao)
                        .eq('user_id', usuarioAtual.id);

                    if (atualError) throw atualError;

                    if (transacaoEditando?.recorrenciaId && aplicarNosProximos) {
                        await atualizarContaFixaEFuturos(
                            transacaoEditando.recorrenciaId,
                            transacaoEditando.data,
                            dadosEdicao
                        );
                    }

                    const mesRegistro = dadosEdicao.data.substring(0, 7);
                    if (filtroMesInput.value !== mesRegistro) {
                        filtroMesInput.value = mesRegistro;
                    }

                    cancelarEdicao(false);
                    await Promise.all([
                        carregarDados(),
                        carregarContasFixas(),
                        carregarCartoesFaturas(),
                        carregarContasCarteiras()
                    ]);

                    showToast(
                        aplicarNosProximos
                            ? 'Conta fixa e próximos meses atualizados!'
                            : 'Lançamento atualizado com sucesso!'
                    );
                    return;
                }

                // ====================================================
                // NOVA CONTA FIXA MENSAL
                // ====================================================
                if (recorrencia === 'fixa') {
                    if (pagamento === 'Cartão de Crédito') {
                        showToast('Conta fixa no cartão será adicionada em uma etapa futura.');
                        return;
                    }

                    submitBtn.textContent = 'Criando conta fixa...';

                    await criarContaFixa({
                        descricao: desc,
                        valor: Number(valorTotal.toFixed(2)),
                        data: dataInput,
                        tipo,
                        status,
                        categoria,
                        pagamento,
                        contaId: contaIdSelecionada
                    });

                    document.getElementById('descricao').value = '';
                    document.getElementById('valor').value = '';
                    document.getElementById('recorrencia').value = 'unica';
                    toggleParcelas();

                    const mesRegistro = dataInput.substring(0, 7);
                    if (filtroMesInput.value !== mesRegistro) {
                        filtroMesInput.value = mesRegistro;
                    }

                    await Promise.all([
                        carregarDados(),
                        carregarContasFixas(),
                        carregarContasCarteiras()
                    ]);
                    showToast('Conta fixa criada e próximos meses preparados!');
                    return;
                }

                // ====================================================
                // NOVO LANÇAMENTO ÚNICO / PARCELADO
                // ====================================================
                const numParc =
                    pagamento === 'Cartão de Crédito'
                        ? (parseInt(document.getElementById('parcelas').value, 10) || 1)
                        : 1;

                const valorBase = Math.floor((valorTotal / numParc) * 100) / 100;
                const totalBaseCentavos = Math.round(valorBase * 100) * numParc;
                const totalCentavos = Math.round(valorTotal * 100);
                const diferencaCentavos = totalCentavos - totalBaseCentavos;
                const grupoId = Date.now();

                const registros = [];
                const cartaoCompra =
                    pagamento === 'Cartão de Crédito'
                        ? obterCartaoPorId(cartaoIdSelecionado)
                        : null;

                for (let i = 0; i < numParc; i++) {
                    let valorParcelaCentavos = Math.round(valorBase * 100);

                    if (i === numParc - 1) {
                        valorParcelaCentavos += diferencaCentavos;
                    }

                    let dataLancamento = adicionarMesesISO(dataInput, i);
                    let dataCompraBanco = null;
                    let faturaMesBanco = null;
                    let cartaoIdBanco = null;
                    let statusBanco = status;
                    let valorPagoBanco =
                        status === 'Pago'
                            ? (valorParcelaCentavos / 100)
                            : 0;

                    if (cartaoCompra) {
                        const calculoFatura = calcularFaturaCartao(
                            dataInput,
                            cartaoCompra,
                            i
                        );

                        if (!calculoFatura) {
                            throw new Error('FATURA_CARTAO_INVALIDA');
                        }

                        dataLancamento = calculoFatura.vencimento;
                        dataCompraBanco = dataInput;
                        faturaMesBanco = calculoFatura.faturaMes;
                        cartaoIdBanco = cartaoCompra.id;

                        // Compra no cartão começa em aberto e será liquidada
                        // individualmente ou pelo botão "Pagar fatura".
                        statusBanco = 'Pendente';
                        valorPagoBanco = 0;
                    }

                    registros.push({
                        user_id: usuarioAtual.id,
                        descricao: desc,
                        valor: valorParcelaCentavos / 100,
                        valor_pago: valorPagoBanco,
                        data: dataLancamento,
                        data_compra: dataCompraBanco,
                        fatura_mes: faturaMesBanco,
                        cartao_id: cartaoIdBanco,
                        conta_id:
                            cartaoCompra
                                ? null
                                : contaIdSelecionada,
                        tipo,
                        status: statusBanco,
                        categoria,
                        pagamento,
                        parcela_atual: i + 1,
                        total_parcelas: numParc,
                        compra_grupo_id: grupoId,
                        recorrente: 'unica',
                        recorrencia_id: null,
                        gerada_automaticamente: false
                    });
                }

                submitBtn.textContent = 'Salvando...';

                const { error } = await supabaseClient
                    .from('transacoes')
                    .insert(registros);

                if (error) throw error;

                document.getElementById('descricao').value = '';
                document.getElementById('valor').value = '';

                const mesRegistro = String(registros[0]?.data || dataInput).substring(0, 7);

                if (filtroMesInput.value !== mesRegistro) {
                    filtroMesInput.value = mesRegistro;
                }

                await Promise.all([
                    carregarDados(),
                    carregarCartoesFaturas(),
                    carregarContasCarteiras()
                ]);

                showToast(
                    pagamento === 'Cartão de Crédito'
                        ? 'Compra lançada na fatura do cartão!'
                        : 'Lançamento salvo na nuvem!'
                );
            } catch (err) {
                console.error(
                    estavaEditando ? "Erro ao editar lançamento:" : "Erro ao salvar lançamento:",
                    err
                );

                if (err?.message === 'RECORRENCIA_MES_DIFERENTE') {
                    showToast('Mantenha o mesmo mês e altere apenas o dia para atualizar a conta fixa.');
                } else {
                    showToast(
                        estavaEditando
                            ? "Erro ao atualizar o lançamento."
                            : "Erro ao salvar lançamento no banco."
                    );
                }
            } finally {
                submitBtn.disabled = false;

                if (edicaoId !== null) {
                    submitBtn.textContent = 'Salvar Alterações';
                } else {
                    submitBtn.textContent = 'Salvar Registro';
                }
            }
        });

        document.getElementById('tipo').addEventListener('change', atualizarRotulosStatus);
        document.getElementById('data').addEventListener('change', atualizarPreviewFatura);
        document.getElementById('parcelas').addEventListener('change', atualizarPreviewFatura);
        atualizarRotulosStatus();

        document.getElementById('filtro-mes').addEventListener('change', async () => {
            await carregarDados();
            await carregarCartoesFaturas();
        });

        document.getElementById('busca-texto').addEventListener('input', carregarDados);
        document.getElementById('filtro-status').addEventListener('change', carregarDados);

        // Fallback de consistência: se o navegador suspender a WebSocket em segundo plano,
        // ao voltar para a aba ou recuperar a internet sincronizamos novamente.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && usuarioAtual) {
                void garantirRecorrenciasFuturas(true).then(() => {
                    agendarAtualizacaoRealtime();
                });
            }
        });

        window.addEventListener('online', () => {
            if (!usuarioAtual) return;

            atualizarStatusRealtime('connecting', '🟡 Reconectando...');

            supabaseClient.auth.getSession().then(({ data, error }) => {
                if (error || !data?.session) {
                    atualizarStatusRealtime('offline', '🔴 Tempo real offline');
                    return;
                }

                void iniciarRealtime(data.session);
                agendarAtualizacaoRealtime();
            });
        });

        window.addEventListener('offline', () => {
            atualizarStatusRealtime('offline', '🔴 Sem internet');
        });
