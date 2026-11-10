export const texto = (t) => ({ tipo: 'texto', texto: t });
export const json = (v) => ({ tipo: 'texto', texto: JSON.stringify(v) ?? 'null' });
/** `data:image/png;base64,...` → conteúdo de imagem. */
export function imagem(dataUrl) {
    const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
    if (!m)
        throw new Error('Imagem inválida: esperado um data URL em base64.');
    return { tipo: 'imagem', dados: m[2], mime: m[1] };
}
/** Esperas entre tentativas de reconexão; a última repete. */
export const ESPERAS_DA_PONTE_MS = [1000, 2000, 5000, 10000];
export function conectarPonte(opcoes) {
    let ferramentas = opcoes.ferramentas, socket = null, fechado = false, tentativas = 0, temporizador = null, avisou = false;
    const agendar = opcoes.agendar ?? ((fn, ms) => setTimeout(fn, ms)), cancelar = opcoes.cancelar ?? (id => clearTimeout(id));
    const endereco = () => opcoes.url ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/__ponte`;
    let conexao = 'conectando', emCurso = 0, ultimaChamadaEm = null, instantaneo;
    const ouvintes = new Set(), agora = opcoes.agora ?? Date.now;
    const fotografar = () => ({ conexao, ocupada: emCurso > 0, ultimaChamadaEm, ferramentas: ferramentas.length });
    instantaneo = fotografar();
    const mudou = () => {
        const novo = fotografar();
        if (novo.conexao === instantaneo.conexao && novo.ocupada === instantaneo.ocupada && novo.ultimaChamadaEm === instantaneo.ultimaChamadaEm && novo.ferramentas === instantaneo.ferramentas)
            return;
        instantaneo = novo;
        for (const fn of [...ouvintes]) {
            try {
                fn(novo);
            }
            catch { /* ouvinte com defeito não derruba a ponte */ }
        }
    };
    const enviar = (m) => { try {
        socket?.send(JSON.stringify(m));
    }
    catch { /* socket caiu: a reconexão cuida */ } };
    const registrar = () => enviar({ tipo: 'registrar', app: opcoes.app, titulo: opcoes.titulo, ferramentas: ferramentas.map(({ nome, descricao, esquema }) => ({ nome, descricao, esquema })) });
    const foco = () => { if (socket)
        enviar({ tipo: 'foco' }); };
    const aoVisibilidade = () => { if (typeof document !== 'undefined' && document.visibilityState === 'visible')
        foco(); };
    async function atender(id, nome, args) {
        const f = ferramentas.find(x => x.nome === nome);
        ultimaChamadaEm = agora();
        emCurso++;
        mudou();
        try {
            await executarChamada(id, f, nome, args);
        }
        finally {
            emCurso--;
            mudou();
        }
    }
    async function executarChamada(id, f, nome, args) {
        if (!f) {
            enviar({ tipo: 'resultado', id, ok: false, erro: `Ferramenta desconhecida: ${nome}` });
            return;
        }
        try {
            enviar({ tipo: 'resultado', id, ok: true, conteudo: await f.executar(args) });
        }
        catch (e) {
            enviar({ tipo: 'resultado', id, ok: false, erro: e instanceof Error ? e.message : String(e) });
        }
    }
    function conectar() {
        if (fechado)
            return;
        let s;
        try {
            s = (opcoes.criarSocket ?? (u => new WebSocket(u)))(endereco());
        }
        catch {
            reconectar();
            return;
        }
        socket = s;
        conexao = 'conectando';
        mudou();
        s.onopen = () => { tentativas = 0; avisou = false; conexao = 'conectada'; mudou(); registrar(); if (typeof document === 'undefined' || document.hasFocus?.() !== false)
            foco(); };
        s.onmessage = ev => {
            let m;
            try {
                m = JSON.parse(String(ev.data));
            }
            catch {
                return;
            }
            const o = m;
            if (o && o.tipo === 'chamar' && typeof o.id === 'string' && typeof o.ferramenta === 'string') {
                const args = o.args && typeof o.args === 'object' && !Array.isArray(o.args) ? o.args : {};
                void atender(o.id, o.ferramenta, args);
            }
        };
        s.onerror = () => { };
        s.onclose = () => {
            if (socket === s) {
                socket = null;
                conexao = 'desligada';
                mudou();
            }
            if (!avisou) {
                avisou = true;
                console.info(`[ponte] sem ponte do assistente (${opcoes.app}); tentando de novo em segundo plano.`);
            }
            reconectar();
        };
    }
    function reconectar() {
        if (fechado || temporizador !== null)
            return;
        const espera = ESPERAS_DA_PONTE_MS[Math.min(tentativas, ESPERAS_DA_PONTE_MS.length - 1)];
        tentativas++;
        temporizador = agendar(() => { temporizador = null; conectar(); }, espera);
    }
    if (typeof addEventListener === 'function')
        addEventListener('focus', foco);
    if (typeof document !== 'undefined')
        document.addEventListener('visibilitychange', aoVisibilidade);
    conectar();
    return {
        estado: () => instantaneo,
        aoMudarEstado(fn) { ouvintes.add(fn); return () => { ouvintes.delete(fn); }; },
        atualizar(novas) { ferramentas = novas; if (socket)
            registrar(); mudou(); },
        fechar() {
            fechado = true;
            conexao = 'desligada';
            mudou();
            if (temporizador !== null) {
                cancelar(temporizador);
                temporizador = null;
            }
            if (typeof removeEventListener === 'function')
                removeEventListener('focus', foco);
            if (typeof document !== 'undefined')
                document.removeEventListener('visibilitychange', aoVisibilidade);
            const s = socket;
            socket = null;
            try {
                s?.close();
            }
            catch { /* já fechado */ }
        },
    };
}
// ---- Ferramentas da campanha (somente leitura) ----
const semBlob = (e) => {
    const { retrato, ...resto } = e;
    return retrato ? { ...resto, retrato: true } : resto;
};
const obrigatorio = (args, campo) => {
    const v = args[campo];
    if (typeof v !== 'string' || v === '')
        throw new Error(`Falta o argumento "${campo}".`);
    return v;
};
const esquemaId = (campo, descricao) => ({ type: 'object', properties: { [campo]: { type: 'string', description: descricao } }, required: [campo], additionalProperties: false });
/** Ferramentas de leitura do `mesa-campanha-v1`; o app passa como abrir o repositório (ele cuida do `app` e do banco). */
export function ferramentasDaCampanha(obterRepositorio) {
    return [
        {
            nome: 'campanha_listar',
            descricao: 'Lista as campanhas (id, nome e sistema).',
            esquema: { type: 'object', properties: {}, required: [], additionalProperties: false },
            async executar() {
                const repo = await obterRepositorio();
                return [json((await repo.listarCampanhas()).map(c => ({ id: c.id, nome: c.nome, sistema: c.sistema })))];
            },
        },
        {
            nome: 'campanha_ler',
            descricao: 'Lê uma campanha: os dados dela, as entidades por tipo (id, nome, tags, refs) e as sessões (id, data, nome, tamanho do roteiro).',
            esquema: esquemaId('campanhaId', 'Id da campanha (veja campanha_listar).'),
            async executar(args) {
                const repo = await obterRepositorio(), id = obrigatorio(args, 'campanhaId');
                const campanha = await repo.obterCampanha(id);
                if (!campanha)
                    throw new Error(`Campanha não encontrada: ${id}`);
                const porTipo = {};
                for (const e of await repo.listarEntidades(id))
                    (porTipo[e.tipo] ??= []).push({ id: e.id, nome: e.nome, tags: e.tags, refs: e.refs, ...(e.retrato ? { retrato: true } : {}) });
                const sessoes = (await repo.listarSessoes(id)).map((s) => ({ id: s.id, nome: s.nome, data: s.data, roteiro: s.roteiro.length }));
                return [json({ campanha: { id: campanha.id, nome: campanha.nome, sistema: campanha.sistema, tema: campanha.tema, capa: campanha.capa !== null }, entidades: porTipo, sessoes })];
            },
        },
        {
            nome: 'campanha_entidade_ler',
            descricao: 'Lê uma entidade inteira (notas, refs, tags) e as ligações dela.',
            esquema: esquemaId('id', 'Id da entidade.'),
            async executar(args) {
                const repo = await obterRepositorio(), id = obrigatorio(args, 'id');
                const entidade = await repo.obterEntidade(id);
                if (!entidade)
                    throw new Error(`Entidade não encontrada: ${id}`);
                const chaves = new Set(entidade.refs.map(r => `${r.app}/${r.tipo}/${r.id}`));
                const ligacoes = (await repo.listarLigacoes(entidade.campanhaId)).filter(l => chaves.has(`${l.de.app}/${l.de.tipo}/${l.de.id}`) || chaves.has(`${l.para.app}/${l.para.tipo}/${l.para.id}`));
                return [json({ entidade: semBlob(entidade), ligacoes })];
            },
        },
        {
            nome: 'campanha_sessao_ler',
            descricao: 'Lê uma sessão inteira: data, roteiro (refs), notas do roteiro e registro.',
            esquema: esquemaId('id', 'Id da sessão (veja campanha_ler).'),
            async executar(args) {
                const repo = await obterRepositorio(), id = obrigatorio(args, 'id');
                for (const c of await repo.listarCampanhas()) {
                    const sessao = (await repo.listarSessoes(c.id)).find(s => s.id === id);
                    if (sessao)
                        return [json({ sessao })];
                }
                throw new Error(`Sessão não encontrada: ${id}`);
            },
        },
    ];
}
