// ============================================================
        // SUPABASE - AUTENTICAÇÃO
        // ============================================================
        const SUPABASE_URL = 'https://ikqpzoorsqcrkqjgzvmi.supabase.co';
        const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_jA_5czmJFDceX7lJMIgrYw_FzR7oAIO';

        const supabaseClient = window.supabase.createClient(
            SUPABASE_URL,
            SUPABASE_PUBLISHABLE_KEY
        );

        let usuarioAtual = null;
        let appInicializado = false;

        // Supabase Realtime (Broadcast privado por usuário)
        let realtimeChannel = null;
        let realtimeUsuarioId = null;
        let realtimeRefreshTimer = null;
        let realtimeParando = false;

        function atualizarStatusRealtime(tipo, texto) {
            const el = document.getElementById('realtime-status');
            if (!el) return;

            el.classList.remove('online', 'connecting', 'offline');
            el.classList.add(tipo);
            el.textContent = texto;
        }

        function agendarAtualizacaoRealtime() {
            if (!usuarioAtual) return;

            if (realtimeRefreshTimer) {
                clearTimeout(realtimeRefreshTimer);
            }

            realtimeRefreshTimer = setTimeout(async () => {
                realtimeRefreshTimer = null;

                try {
                    // carregarDados possui uma fila interna. Se houver uma atualização
                    // em andamento, esta chamada será executada logo em seguida.
                    await Promise.all([
                        carregarDados(),
                        carregarContasFixas(),
                        carregarCartoesFaturas(),
                        carregarContasCarteiras(),
                        atualizarHistoricoLiquidacaoAberto()
                    ]);
                } catch (err) {
                    console.error('Erro ao atualizar dados recebidos em tempo real:', err);
                }
            }, 80);
        }

        function tratarEventoRealtime(payload) {
            // Não confiamos nos dados do payload para montar a tela.
            // Ao receber qualquer alteração autorizada no tópico privado do usuário,
            // buscamos novamente os dados via API/RLS. Isso mantém o dashboard consistente.
            console.log('Alteração em tempo real recebida:', payload?.event || payload?.type || 'CHANGE');

            // Se a linha que estava aberta em edição for excluída em outro dispositivo,
            // fecha o modo de edição local.
            const registroAntigo = payload?.payload?.old_record || payload?.old || null;
            const registroNovo = payload?.payload?.record || payload?.new || null;
            const idAlterado = Number(registroNovo?.id ?? registroAntigo?.id ?? 0);

            if (edicaoId !== null && idAlterado && Number(edicaoId) === idAlterado) {
                const evento = String(payload?.event || payload?.type || '').toUpperCase();
                if (evento === 'DELETE') {
                    cancelarEdicao(false);
                    showToast('O lançamento em edição foi excluído em outro dispositivo.');
                }
            }

            agendarAtualizacaoRealtime();
        }

        async function pararRealtime() {
            if (realtimeParando) return;
            realtimeParando = true;

            try {
                if (realtimeRefreshTimer) {
                    clearTimeout(realtimeRefreshTimer);
                    realtimeRefreshTimer = null;
                }

                if (realtimeChannel) {
                    const canalAnterior = realtimeChannel;
                    realtimeChannel = null;
                    realtimeUsuarioId = null;

                    try {
                        await supabaseClient.removeChannel(canalAnterior);
                    } catch (err) {
                        console.warn('Não foi possível remover o canal Realtime anterior:', err);
                    }
                } else {
                    realtimeUsuarioId = null;
                }
            } finally {
                realtimeParando = false;
            }
        }

        async function iniciarRealtime(session) {
            if (!usuarioAtual || !session) return;

            const userId = usuarioAtual.id;

            // Evita criar dois canais para a mesma sessão.
            if (realtimeChannel && realtimeUsuarioId === userId) {
                try {
                    await supabaseClient.realtime.setAuth(session.access_token);
                } catch (err) {
                    console.warn('Não foi possível renovar a autenticação do Realtime:', err);
                }
                return;
            }

            atualizarStatusRealtime('connecting', '🟡 Conectando...');

            await pararRealtime();

            if (!usuarioAtual || usuarioAtual.id !== userId) return;

            try {
                // Realtime Authorization usa o JWT da sessão atual.
                await supabaseClient.realtime.setAuth(session.access_token);

                const topic = `financeiro:${userId}`;

                const canal = supabaseClient.channel(topic, {
                    config: {
                        private: true
                    }
                });

                canal
                    .on('broadcast', { event: 'INSERT' }, tratarEventoRealtime)
                    .on('broadcast', { event: 'UPDATE' }, tratarEventoRealtime)
                    .on('broadcast', { event: 'DELETE' }, tratarEventoRealtime)
                    .subscribe((status, err) => {
                        if (canal !== realtimeChannel) return;

                        if (status === 'SUBSCRIBED') {
                            atualizarStatusRealtime('online', '🟢 Tempo real ativo');
                            console.log('Supabase Realtime conectado:', topic);
                            return;
                        }

                        if (
                            status === 'CHANNEL_ERROR' ||
                            status === 'TIMED_OUT' ||
                            status === 'CLOSED'
                        ) {
                            atualizarStatusRealtime('offline', '🔴 Tempo real offline');

                            if (err) {
                                console.error('Erro no Supabase Realtime:', err);
                            }
                        }
                    });

                realtimeChannel = canal;
                realtimeUsuarioId = userId;
            } catch (err) {
                console.error('Erro ao iniciar Supabase Realtime:', err);
                atualizarStatusRealtime('offline', '🔴 Tempo real offline');
            }
        }

        function mensagemLogin(texto, erro = true) {
            const el = document.getElementById('auth-message');
            el.textContent = texto || '';
            el.style.color = erro ? 'var(--danger)' : 'var(--primary)';
        }

        function traduzirErroLogin(message) {
            const msg = (message || '').toLowerCase();
            if (msg.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
            if (msg.includes('email not confirmed')) return 'Seu e-mail ainda não foi confirmado.';
            if (msg.includes('too many requests')) return 'Muitas tentativas. Aguarde um pouco e tente novamente.';
            return 'Não foi possível entrar. Verifique seus dados e tente novamente.';
        }

        async function mostrarAplicativo(session) {
            if (!session || !session.user) return;

            usuarioAtual = session.user;
            document.getElementById('auth-screen').style.display = 'none';
            document.getElementById('app-container').style.display = 'block';
            document.getElementById('user-email').textContent = usuarioAtual.email || 'Usuário';

            if (!appInicializado) {
                appInicializado = true;
                await checarPIN();
                await garantirRecorrenciasFuturas(true);
                await Promise.all([
                    carregarCartoesFaturas(),
                    carregarContasCarteiras()
                ]);
                await carregarDados();
                await carregarContasFixas();
                await verificarDadosLocaisParaMigracao();
            }

            // Inicia o canal privado do usuário ou atualiza seu JWT
            // quando o Supabase renovar a sessão.
            await iniciarRealtime(session);
        }

        function mostrarTelaLogin() {
            void pararRealtime();
            atualizarStatusRealtime('offline', '🔴 Desconectado');

            usuarioAtual = null;
            appInicializado = false;
            recarregarDadosDepois = false;
            edicaoId = null;
            transacaoEditando = null;
            document.getElementById('app-container').style.display = 'none';
            document.getElementById('lock-screen').style.display = 'none';
            document.getElementById('auth-screen').style.display = 'flex';
            document.getElementById('auth-password').value = '';
        }

        document.getElementById('auth-form').addEventListener('submit', async (e) => {
            e.preventDefault();

            const email = document.getElementById('auth-email').value.trim();
            const password = document.getElementById('auth-password').value;
            const btn = document.getElementById('auth-submit');

            mensagemLogin('Entrando...', false);
            btn.disabled = true;
            btn.textContent = 'Entrando...';

            try {
                const { data, error } = await supabaseClient.auth.signInWithPassword({
                    email,
                    password
                });

                if (error) throw error;

                mensagemLogin('', false);
                await mostrarAplicativo(data.session);
            } catch (err) {
                console.error('Erro no login:', err);
                mensagemLogin(traduzirErroLogin(err.message));
            } finally {
                btn.disabled = false;
                btn.textContent = 'Entrar';
            }
        });

        async function logoutSupabase() {
            try {
                const { error } = await supabaseClient.auth.signOut();
                if (error) throw error;
                mostrarTelaLogin();
            } catch (err) {
                console.error('Erro ao sair:', err);
                showToast('Não foi possível sair. Tente novamente.');
            }
        }

        async function inicializarAutenticacao() {
            try {
                const { data, error } = await supabaseClient.auth.getSession();
                if (error) throw error;

                if (data.session) {
                    await mostrarAplicativo(data.session);
                } else {
                    mostrarTelaLogin();
                }
            } catch (err) {
                console.error('Erro ao verificar sessão:', err);
                mostrarTelaLogin();
                mensagemLogin('Não foi possível verificar sua sessão. Confira sua conexão.');
            }
        }

        supabaseClient.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_OUT' || !session) {
                mostrarTelaLogin();
                return;
            }

            if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
                void mostrarAplicativo(session);
            }
        });
