async function carregarTodasRecorrenciasSupabase(incluirInativas = false) {
            if (!usuarioAtual) return [];

            let query = supabaseClient
                .from('recorrencias')
                .select('*')
                .eq('user_id', usuarioAtual.id)
                .order('descricao', { ascending: true });

            if (!incluirInativas) {
                query = query.eq('ativo', true);
            }

            const { data, error } = await query;
            if (error) throw error;
            return data || [];
        }

        async function garantirRegraRecorrenteFutura(regra) {
            if (!usuarioAtual || !regra?.id || !regra.ativo) return 0;

            const { data: existentes, error: existentesError } = await supabaseClient
                .from('transacoes')
                .select('id,data')
                .eq('user_id', usuarioAtual.id)
                .eq('recorrencia_id', regra.id)
                .order('data', { ascending: false });

            if (existentesError) throw existentesError;

            const inicioRegra = regra.data_inicio;
            const mesAtualInicio = inicioMesISO(hojeStr);
            const mesInicioRegra = inicioMesISO(inicioRegra);

            const baseHorizonte = compararMeses(mesInicioRegra, mesAtualInicio) > 0
                ? mesParaDate(mesInicioRegra)
                : mesParaDate(mesAtualInicio);

            const horizonte = new Date(
                baseHorizonte.getFullYear(),
                baseHorizonte.getMonth() + MESES_RECORRENCIA_FUTURA,
                1,
                12,
                0,
                0
            );

            let cursor;

            if (existentes && existentes.length > 0) {
                const ultimaData = existentes[0].data;
                const ultimoMes = mesParaDate(ultimaData);
                const mesAtual = mesParaDate(mesAtualInicio);

                if (ultimoMes < mesAtual) {
                    cursor = mesAtual;
                } else {
                    cursor = new Date(
                        ultimoMes.getFullYear(),
                        ultimoMes.getMonth() + 1,
                        1,
                        12,
                        0,
                        0
                    );
                }
            } else {
                const inicio = mesParaDate(mesInicioRegra);
                const atual = mesParaDate(mesAtualInicio);
                cursor = inicio < atual ? atual : inicio;
            }

            const inicioPermitido = mesParaDate(mesInicioRegra);
            if (cursor < inicioPermitido) cursor = inicioPermitido;

            const registros = [];

            while (cursor <= horizonte) {
                const dataLancamento = dataMesComDia(
                    cursor.getFullYear(),
                    cursor.getMonth(),
                    regra.dia_vencimento
                );

                registros.push({
                    user_id: usuarioAtual.id,
                    descricao: regra.descricao,
                    valor: Number(regra.valor || 0),
                    valor_pago: 0,
                    data: dataLancamento,
                    tipo: regra.tipo,
                    status: 'Pendente',
                    categoria: regra.categoria,
                    pagamento: regra.pagamento,
                    parcela_atual: 1,
                    total_parcelas: 1,
                    compra_grupo_id: null,
                    conta_id: regra.conta_id || null,
                    recorrente: 'fixa',
                    recorrencia_id: regra.id,
                    gerada_automaticamente: true
                });

                cursor = new Date(
                    cursor.getFullYear(),
                    cursor.getMonth() + 1,
                    1,
                    12,
                    0,
                    0
                );
            }

            if (registros.length === 0) return 0;

            const { error } = await supabaseClient
                .from('transacoes')
                .upsert(registros, {
                    onConflict: 'recorrencia_id,data',
                    ignoreDuplicates: true
                });

            if (error) throw error;
            return registros.length;
        }

        async function garantirRecorrenciasFuturas(silencioso = true) {
            if (!usuarioAtual || gerandoRecorrencias) return;

            gerandoRecorrencias = true;

            try {
                const regras = await carregarTodasRecorrenciasSupabase(false);
                let geradas = 0;

                for (const regra of regras) {
                    geradas += await garantirRegraRecorrenteFutura(regra);
                }

                if (!silencioso && geradas > 0) {
                    showToast(`${geradas} lançamento(s) fixo(s) preparado(s).`);
                }
            } catch (err) {
                console.error('Erro ao gerar contas fixas futuras:', err);
                if (!silencioso) {
                    showToast('Não foi possível atualizar as contas fixas.');
                }
            } finally {
                gerandoRecorrencias = false;
            }
        }

        async function carregarContasFixas() {
            if (!usuarioAtual || carregandoRecorrencias) return;

            carregandoRecorrencias = true;

            try {
                const regras = await carregarTodasRecorrenciasSupabase(false);
                const list = document.getElementById('recurring-list');
                const count = document.getElementById('recurring-count');

                count.textContent = `${regras.length} ativa(s)`;
                list.innerHTML = '';

                if (regras.length === 0) {
                    list.innerHTML = '<div class="recurring-empty">Nenhuma conta fixa ativa.</div>';
                    return;
                }

                regras.forEach(regra => {
                    const item = document.createElement('div');
                    item.className = 'recurring-item';

                    item.innerHTML = `
                        <div class="recurring-main">
                            <div class="recurring-title">${escaparHTML(regra.descricao)}</div>
                            <div class="recurring-meta">
                                ${formatarMoeda(regra.valor)} • dia ${Number(regra.dia_vencimento)} • ${escaparHTML(regra.categoria)}
                            </div>
                        </div>
                        <button class="btn-stop-recurring" onclick="pararRecorrencia('${regra.id}')">⏹ Parar</button>
                    `;

                    list.appendChild(item);
                });
            } catch (err) {
                console.error('Erro ao carregar contas fixas:', err);
            } finally {
                carregandoRecorrencias = false;
            }
        }

        async function pararRecorrencia(recorrenciaId) {
            if (!usuarioAtual) return;

            if (!confirm(
                'Parar esta conta fixa mensal?\n\n' +
                'Os lançamentos automáticos pendentes dos próximos meses serão removidos. ' +
                'O histórico e o mês atual serão mantidos.'
            )) {
                return;
            }

            try {
                const { error: regraError } = await supabaseClient
                    .from('recorrencias')
                    .update({ ativo: false })
                    .eq('id', recorrenciaId)
                    .eq('user_id', usuarioAtual.id);

                if (regraError) throw regraError;

                const proximoMes = inicioProximoMesISO(hojeStr);

                const { error: deleteError } = await supabaseClient
                    .from('transacoes')
                    .delete()
                    .eq('user_id', usuarioAtual.id)
                    .eq('recorrencia_id', recorrenciaId)
                    .eq('gerada_automaticamente', true)
                    .eq('status', 'Pendente')
                    .gte('data', proximoMes);

                if (deleteError) throw deleteError;

                await carregarContasFixas();
                await carregarDados();
                showToast('Conta fixa encerrada.');
            } catch (err) {
                console.error('Erro ao parar conta fixa:', err);
                showToast('Não foi possível parar a conta fixa.');
            }
        }

        async function criarContaFixa(dados) {
            const diaVencimento = Number(String(dados.data).split('-')[2]);

            const { data: regra, error: regraError } = await supabaseClient
                .from('recorrencias')
                .insert({
                    user_id: usuarioAtual.id,
                    descricao: dados.descricao,
                    valor: dados.valor,
                    tipo: dados.tipo,
                    categoria: dados.categoria,
                    pagamento: dados.pagamento,
                    conta_id: dados.contaId || null,
                    dia_vencimento: diaVencimento,
                    data_inicio: dados.data,
                    ativo: true
                })
                .select('*')
                .single();

            if (regraError) throw regraError;

            try {
                const { error: inicialError } = await supabaseClient
                    .from('transacoes')
                    .insert({
                        user_id: usuarioAtual.id,
                        descricao: dados.descricao,
                        valor: dados.valor,
                        valor_pago: dados.status === 'Pago' ? dados.valor : 0,
                        data: dados.data,
                        tipo: dados.tipo,
                        status: dados.status,
                        categoria: dados.categoria,
                        pagamento: dados.pagamento,
                        parcela_atual: 1,
                        total_parcelas: 1,
                        compra_grupo_id: null,
                        conta_id: dados.contaId || null,
                        recorrente: 'fixa',
                        recorrencia_id: regra.id,
                        gerada_automaticamente: false
                    });

                if (inicialError) throw inicialError;

                try {
                    await garantirRegraRecorrenteFutura(regra);
                } catch (futureErr) {
                    console.error('Conta fixa criada, mas houve erro ao preparar meses futuros:', futureErr);
                }

                return regra;
            } catch (err) {
                // Evita deixar uma regra órfã caso o lançamento inicial falhe.
                await supabaseClient
                    .from('recorrencias')
                    .delete()
                    .eq('id', regra.id)
                    .eq('user_id', usuarioAtual.id);

                throw err;
            }
        }

        async function atualizarContaFixaEFuturos(recorrenciaId, dataOriginal, dados) {
            const novoDia = Number(String(dados.data).split('-')[2]);

            if (String(dataOriginal).substring(0, 7) !== String(dados.data).substring(0, 7)) {
                throw new Error('RECORRENCIA_MES_DIFERENTE');
            }

            const { error: regraError } = await supabaseClient
                .from('recorrencias')
                .update({
                    descricao: dados.descricao,
                    valor: dados.valor,
                    tipo: dados.tipo,
                    categoria: dados.categoria,
                    pagamento: dados.pagamento,
                    conta_id: dados.contaId || null,
                    dia_vencimento: novoDia
                })
                .eq('id', recorrenciaId)
                .eq('user_id', usuarioAtual.id);

            if (regraError) throw regraError;

            const { data: futuras, error: futurasError } = await supabaseClient
                .from('transacoes')
                .select('id,data')
                .eq('user_id', usuarioAtual.id)
                .eq('recorrencia_id', recorrenciaId)
                .gte('data', dataOriginal)
                .order('data', { ascending: true });

            if (futurasError) throw futurasError;

            for (const item of (futuras || [])) {
                const [ano, mes] = String(item.data).split('-').map(Number);
                const novaData = dataMesComDia(ano, mes - 1, novoDia);

                const atualizacao = {
                    descricao: dados.descricao,
                    valor: dados.valor,
                    data: novaData,
                    tipo: dados.tipo,
                    categoria: dados.categoria,
                    pagamento: dados.pagamento,
                    conta_id: dados.contaId || null,
                    recorrente: 'fixa'
                };

                const { error } = await supabaseClient
                    .from('transacoes')
                    .update(atualizacao)
                    .eq('id', item.id)
                    .eq('user_id', usuarioAtual.id);

                if (error) throw error;
            }
        }
