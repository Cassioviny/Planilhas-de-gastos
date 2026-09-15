// ============================================================
        // MIGRAÇÃO DO ANTIGO INDEXEDDB PARA O SUPABASE
        // ============================================================
        function assinaturaTransacao(t) {
            return [
                String(t.descricao || '').trim().toLowerCase(),
                Number(t.valor || 0).toFixed(2),
                t.data || '',
                t.tipo || '',
                t.status || '',
                t.categoria || '',
                t.pagamento || '',
                Number(t.parcela_atual ?? t.parcelaAtual ?? 1),
                Number(t.total_parcelas ?? t.totalParcelas ?? 1),
                t.recorrente || 'unica'
            ].join('|');
        }

        async function verificarDadosLocaisParaMigracao() {
            const botao = document.getElementById('btn-migrar-local');

            try {
                if (!dbLocal.isOpen()) {
                    await dbLocal.open();
                }

                const quantidade = await dbLocal.transacoes.count();

                if (quantidade > 0) {
                    botao.style.display = 'block';
                    botao.textContent =
                        `☁️ Migrar ${quantidade} lançamento(s) deste navegador`;
                } else {
                    botao.style.display = 'none';
                }
            } catch (err) {
                console.log("Nenhum banco local para migrar:", err);
                botao.style.display = 'none';
            }
        }

        async function migrarDadosLocais() {
            const botao = document.getElementById('btn-migrar-local');

            try {
                if (!usuarioAtual) {
                    showToast("Entre novamente antes de migrar.");
                    return;
                }

                if (!dbLocal.isOpen()) {
                    await dbLocal.open();
                }

                const locais = await dbLocal.transacoes.toArray();

                if (locais.length === 0) {
                    botao.style.display = 'none';
                    showToast("Não há lançamentos locais para migrar.");
                    return;
                }

                if (!confirm(
                    `Foram encontrados ${locais.length} lançamento(s) salvos neste navegador.\n\n` +
                    `Eles serão copiados para sua conta no Supabase. Os dados locais não serão apagados.\n\nContinuar?`
                )) {
                    return;
                }

                botao.disabled = true;
                botao.textContent = 'Migrando...';

                const nuvem = await carregarTodasTransacoesSupabase();

                // Compara a quantidade de ocorrências de cada lançamento.
                // Assim, se existirem dois lançamentos realmente idênticos no
                // banco local, os dois são preservados, sem duplicar em uma
                // segunda tentativa de migração.
                const contagemNuvem = new Map();

                nuvem.forEach(t => {
                    const assinatura = assinaturaTransacao(t);
                    contagemNuvem.set(
                        assinatura,
                        (contagemNuvem.get(assinatura) || 0) + 1
                    );
                });

                const vistosLocais = new Map();
                const novos = [];

                locais
                    .map(prepararTransacaoParaBanco)
                    .filter(t => Boolean(t.descricao && t.data))
                    .forEach(t => {
                        const assinatura = assinaturaTransacao(t);
                        const ocorrenciaLocal = vistosLocais.get(assinatura) || 0;
                        const quantidadeJaNaNuvem = contagemNuvem.get(assinatura) || 0;

                        if (ocorrenciaLocal >= quantidadeJaNaNuvem) {
                            novos.push(t);
                        }

                        vistosLocais.set(assinatura, ocorrenciaLocal + 1);
                    });

                if (novos.length > 0) {
                    const tamanhoLote = 500;

                    for (let i = 0; i < novos.length; i += tamanhoLote) {
                        const lote = novos.slice(i, i + tamanhoLote);

                        const { error } = await supabaseClient
                            .from('transacoes')
                            .insert(lote);

                        if (error) throw error;
                    }
                }

                try {
                    const metaLocal = await dbLocal.configs.get('meta_mensal');
                    const metaNuvem = await obterConfig('meta_mensal');

                    if (
                        metaLocal &&
                        metaLocal.valor !== undefined &&
                        (metaNuvem === null || metaNuvem === undefined)
                    ) {
                        await salvarConfig(
                            'meta_mensal',
                            Number(metaLocal.valor || 0)
                        );
                    }
                } catch (configErr) {
                    console.log("Meta local não foi migrada:", configErr);
                }

                await carregarDados();

                const ignorados = locais.length - novos.length;

                if (novos.length > 0) {
                    showToast(
                        ignorados > 0
                            ? `${novos.length} migrado(s); ${ignorados} já existia(m) na nuvem.`
                            : `${novos.length} lançamento(s) migrado(s) para a nuvem!`
                    );
                } else {
                    showToast("Todos os lançamentos locais já estavam na nuvem.");
                }

                botao.style.display = 'none';
            } catch (err) {
                console.error("Erro na migração:", err);
                showToast("Não foi possível migrar os dados locais.");
                await verificarDadosLocaisParaMigracao();
            } finally {
                botao.disabled = false;
            }
        }
