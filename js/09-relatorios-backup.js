async function exportarCSV() {
            try {
                const dados = await carregarTodasTransacoesSupabase();

                let csv = "\uFEFFID;Descricao;Valor Total;Valor Liquidado;Restante;Data;Tipo;Status;Categoria;Pagamento;Parcela;TotalParcelas\n";

                dados.forEach(d => {
                    const descricao = String(d.descricao || '').replaceAll('"', '""');
                    const categoria = String(d.categoria || '').replaceAll('"', '""');
                    const pagamento = String(d.pagamento || '').replaceAll('"', '""');

                    const total = Number(d.valor || 0);
                    const liquidado = Math.max(
                        0,
                        Math.min(total, Number(d.valorPago || 0))
                    );
                    const restante = Math.max(0, total - liquidado);

                    csv += [
                        d.id,
                        `"${descricao}"`,
                        total.toFixed(2).replace('.', ','),
                        liquidado.toFixed(2).replace('.', ','),
                        restante.toFixed(2).replace('.', ','),
                        d.data,
                        d.tipo,
                        d.status,
                        `"${categoria}"`,
                        `"${pagamento}"`,
                        d.parcelaAtual || 1,
                        d.totalParcelas || 1
                    ].join(';') + '\n';
                });

                const blob = new Blob([csv], {
                    type: 'text/csv;charset=utf-8;'
                });

                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = `relatorio_financeiro_${filtroMesInput.value}.csv`;
                link.click();

                setTimeout(() => URL.revokeObjectURL(link.href), 1000);
                showToast("CSV exportado!");
            } catch (err) {
                console.error("Erro ao exportar CSV:", err);
                showToast("Erro ao exportar CSV.");
            }
        }

        async function exportarPDF() {
            try {
                const { jsPDF } = window.jspdf;
                const doc = new jsPDF();
                const dados = await carregarTodasTransacoesSupabase();

                const filtrados = dados.filter(t =>
                    t.data &&
                    t.data.startsWith(filtroMesInput.value)
                );

                doc.setFontSize(16);
                doc.text(`Relatorio Financeiro - ${filtroMesInput.value}`, 14, 20);
                doc.setFontSize(10);

                let y = 30;

                filtrados.forEach(t => {
                    const descricao = String(t.descricao || '').substring(0, 55);
                    const total = Number(t.valor || 0);
                    const liquidado = Math.max(
                        0,
                        Math.min(total, Number(t.valorPago || 0))
                    );
                    const restante = Math.max(0, total - liquidado);

                    const detalheParcial =
                        liquidado > 0 && restante > 0
                            ? ` | Liquidado: R$ ${liquidado.toFixed(2)} | Restante: R$ ${restante.toFixed(2)}`
                            : '';

                    const linha =
                        `${t.data} - ${descricao} (${t.categoria}): R$ ${total.toFixed(2)} [${t.status}]${detalheParcial}`;

                    const linhas = doc.splitTextToSize(linha, 180);

                    linhas.forEach(parte => {
                        if (y > 280) {
                            doc.addPage();
                            y = 20;
                        }

                        doc.text(parte, 14, y);
                        y += 7;
                    });
                });

                if (filtrados.length === 0) {
                    doc.text('Nenhum lancamento encontrado neste periodo.', 14, 30);
                }

                doc.save(`Relatorio_${filtroMesInput.value}.pdf`);
                showToast("PDF gerado com sucesso!");
            } catch (err) {
                console.error("Erro ao exportar PDF:", err);
                showToast("Erro ao gerar PDF.");
            }
        }

        async function exportarBackup() {
            try {
                const transacoes = await carregarTodasTransacoesSupabase();
                const recorrencias = await carregarTodasRecorrenciasSupabase(true);
                const cartoes = await carregarTodosCartoesSupabase(true);
                const contas = await carregarTodasContasSupabase(true);
                const metaMensal = await obterConfig('meta_mensal');

                const backup = {
                    versao: 8,
                    exportado_em: new Date().toISOString(),
                    transacoes,
                    recorrencias,
                    cartoes,
                    contas,
                    configs: {
                        meta_mensal: metaMensal
                    }
                };

                const blob = new Blob(
                    [JSON.stringify(backup, null, 2)],
                    { type: 'application/json;charset=utf-8' }
                );

                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = `backup_financas_${dataLocalISO()}.json`;
                link.click();

                setTimeout(() => URL.revokeObjectURL(link.href), 1000);
                showToast("Backup criado!");
            } catch (err) {
                console.error("Erro ao criar backup:", err);
                showToast("Erro ao criar backup.");
            }
        }

        function extrairTransacoesBackup(conteudo) {
            if (Array.isArray(conteudo)) {
                return conteudo;
            }

            if (
                conteudo &&
                typeof conteudo === 'object' &&
                Array.isArray(conteudo.transacoes)
            ) {
                return conteudo.transacoes;
            }

            return null;
        }

        async function importarBackup(e) {
            const arquivo = e.target.files && e.target.files[0];
            e.target.value = '';

            if (!arquivo) return;

            const reader = new FileReader();

            reader.onload = async function (evt) {
                try {
                    const conteudo = JSON.parse(evt.target.result);
                    const transacoesOriginais = extrairTransacoesBackup(conteudo);

                    if (!transacoesOriginais) {
                        showToast("Arquivo de backup inválido.");
                        return;
                    }

                    if (!confirm(
                        `O backup possui ${transacoesOriginais.length} lançamento(s).\n\n` +
                        `A restauração substituirá TODOS os seus lançamentos atuais na nuvem.\n\nContinuar?`
                    )) {
                        return;
                    }

                    const recorrenciasBackup = (
                        conteudo &&
                        !Array.isArray(conteudo) &&
                        Array.isArray(conteudo.recorrencias)
                    ) ? conteudo.recorrencias : [];

                    const cartoesBackup = (
                        conteudo &&
                        !Array.isArray(conteudo) &&
                        Array.isArray(conteudo.cartoes)
                    ) ? conteudo.cartoes : [];

                    const contasBackup = (
                        conteudo &&
                        !Array.isArray(conteudo) &&
                        Array.isArray(conteudo.contas)
                    ) ? conteudo.contas : [];



                    const idsRecorrenciasBackup = new Set(
                        recorrenciasBackup
                            .map(r => r && r.id)
                            .filter(Boolean)
                    );

                    const idsCartoesBackup = new Set(
                        cartoesBackup
                            .map(c => c && c.id)
                            .filter(Boolean)
                    );

                    const idsContasBackup = new Set(
                        contasBackup
                            .map(c => c && c.id)
                            .filter(Boolean)
                    );

                    const preparados = transacoesOriginais
                        .map(prepararTransacaoParaBanco)
                        .map(t => {
                            if (!t.recorrencia_id || !idsRecorrenciasBackup.has(t.recorrencia_id)) {
                                t.recorrencia_id = null;
                                t.gerada_automaticamente = false;
                            }

                            if (!t.cartao_id || !idsCartoesBackup.has(t.cartao_id)) {
                                t.cartao_id = null;
                                t.data_compra = null;
                                t.fatura_mes = null;
                            }

                            if (!t.conta_id || !idsContasBackup.has(t.conta_id)) {
                                t.conta_id = null;
                            }

                            return t;
                        })
                        .filter(t =>
                            t.descricao &&
                            t.valor >= 0 &&
                            t.data
                        );

                    const { error: deleteError } = await supabaseClient
                        .from('transacoes')
                        .delete()
                        .eq('user_id', usuarioAtual.id);

                    if (deleteError) throw deleteError;

                    const { error: deleteRecError } = await supabaseClient
                        .from('recorrencias')
                        .delete()
                        .eq('user_id', usuarioAtual.id);

                    if (deleteRecError) throw deleteRecError;

                    const { error: deleteCardError } = await supabaseClient
                        .from('cartoes')
                        .delete()
                        .eq('user_id', usuarioAtual.id);

                    if (deleteCardError) throw deleteCardError;

                    const { error: deleteAccountsError } = await supabaseClient
                        .from('contas')
                        .delete()
                        .eq('user_id', usuarioAtual.id);

                    if (deleteAccountsError) throw deleteAccountsError;

                    if (contasBackup.length > 0) {
                        const contasPreparadas = contasBackup
                            .filter(c => c && c.id && c.nome)
                            .map(c => ({
                                id: c.id,
                                user_id: usuarioAtual.id,
                                nome: String(c.nome),
                                tipo: c.tipo || 'Outros',
                                saldo_inicial: Number(c.saldo_inicial || 0),
                                ativo: c.ativo !== false
                            }));

                        if (contasPreparadas.length > 0) {
                            const { error: insertAccountsError } =
                                await supabaseClient
                                    .from('contas')
                                    .insert(contasPreparadas);

                            if (insertAccountsError) {
                                throw insertAccountsError;
                            }
                        }
                    }

                    if (cartoesBackup.length > 0) {
                        const cartoesPreparados = cartoesBackup
                            .filter(c => c && c.id && c.nome)
                            .map(c => ({
                                id: c.id,
                                user_id: usuarioAtual.id,
                                nome: String(c.nome),
                                limite: Number(c.limite || 0),
                                dia_fechamento: Number(c.dia_fechamento || 1),
                                dia_vencimento: Number(c.dia_vencimento || 1),
                                ativo: c.ativo !== false
                            }))
                            .filter(c =>
                                c.limite > 0 &&
                                c.dia_fechamento >= 1 &&
                                c.dia_fechamento <= 31 &&
                                c.dia_vencimento >= 1 &&
                                c.dia_vencimento <= 31
                            );

                        if (cartoesPreparados.length > 0) {
                            const { error: insertCardError } = await supabaseClient
                                .from('cartoes')
                                .insert(cartoesPreparados);

                            if (insertCardError) throw insertCardError;
                        }
                    }

                    if (recorrenciasBackup.length > 0) {
                        const regrasPreparadas = recorrenciasBackup
                            .filter(r => r && r.id && r.descricao && r.data_inicio)
                            .map(r => ({
                                id: r.id,
                                user_id: usuarioAtual.id,
                                descricao: String(r.descricao),
                                valor: Number(r.valor || 0),
                                tipo: r.tipo === 'entrada' ? 'entrada' : 'saida',
                                categoria: r.categoria || 'Outros',
                                pagamento: r.pagamento || 'A Vista',
                                conta_id:
                                    r.conta_id && idsContasBackup.has(r.conta_id)
                                        ? r.conta_id
                                        : null,
                                dia_vencimento: Number(r.dia_vencimento || String(r.data_inicio).split('-')[2] || 1),
                                data_inicio: r.data_inicio,
                                ativo: r.ativo !== false
                            }));

                        if (regrasPreparadas.length > 0) {
                            const { error: insertRecError } = await supabaseClient
                                .from('recorrencias')
                                .insert(regrasPreparadas);

                            if (insertRecError) throw insertRecError;
                        }
                    }

                    if (preparados.length > 0) {
                        const tamanhoLote = 500;

                        for (let i = 0; i < preparados.length; i += tamanhoLote) {
                            const lote = preparados.slice(i, i + tamanhoLote);

                            const { error: insertError } = await supabaseClient
                                .from('transacoes')
                                .insert(lote);

                            if (insertError) throw insertError;
                        }
                    }

                    if (
                        conteudo &&
                        !Array.isArray(conteudo) &&
                        conteudo.configs &&
                        conteudo.configs.meta_mensal !== undefined
                    ) {
                        await salvarConfig(
                            'meta_mensal',
                            conteudo.configs.meta_mensal
                        );
                    }

                    await garantirRecorrenciasFuturas(true);
                    await Promise.all([
                        carregarCartoesFaturas(),
                        carregarContasCarteiras()
                    ]);
                    await carregarDados();
                    await carregarContasFixas();
                    showToast("Backup restaurado na nuvem!");
                } catch (err) {
                    console.error("Erro ao importar backup:", err);
                    showToast("Erro ao importar backup.");
                }
            };

            reader.readAsText(arquivo);
        }
