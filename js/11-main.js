if ('serviceWorker' in navigator) {
            let recarregandoPorNovoSW = false;

            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (recarregandoPorNovoSW) return;

                recarregandoPorNovoSW = true;
                window.location.reload();
            });

            window.addEventListener('load', async () => {
                try {
                    const registroSW = await navigator.serviceWorker.register(
                        './sw.js',
                        {
                            updateViaCache: 'none'
                        }
                    );

                    // Verifica imediatamente se existe uma versão mais nova.
                    await registroSW.update();

                    // Ao voltar para a aba, verifica novamente.
                    document.addEventListener('visibilitychange', () => {
                        if (!document.hidden) {
                            registroSW.update().catch(() => {});
                        }
                    });

                    // Enquanto o app permanecer aberto, verifica periodicamente.
                    setInterval(() => {
                        registroSW.update().catch(() => {});
                    }, 5 * 60 * 1000);

                } catch (err) {
                    console.log('SW Error:', err);
                }
            });
        }

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                fecharHistoricoLiquidacao();
            }
        });

        // Inicialização
        inicializarAutenticacao();
