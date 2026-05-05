import { useEffect, useRef } from "preact/hooks";
import {
    AmbientLight,
    Box3,
    Color,
    ColorManagement,
    DirectionalLight,
    DoubleSide,
    Group,
    Mesh,
    MeshStandardMaterial,
    Object3D,
    PerspectiveCamera,
    Scene,
    SRGBColorSpace,
    Vector3,
    WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

export type SceneMeshPayload = { obj: string; mtl: string } | null;

type Ctx = {
    scene: Scene;
    camera: PerspectiveCamera;
    renderer: WebGLRenderer;
    controls: OrbitControls;
    content: Group;
};

function stripMtllib(obj: string): string {
    return obj.replace(/^mtllib\s+.*$/m, "");
}

function disposeObject3D(root: Object3D): void {
    root.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) {
            m.geometry?.dispose();
            const mat = m.material;
            if (Array.isArray(mat)) {
                for (const x of mat) x?.dispose?.();
            } else {
                mat?.dispose?.();
            }
        }
    });
}

function applyFallbackMaterial(root: Group): void {
    const mat = new MeshStandardMaterial({
        color: 0x9ca3af,
        metalness: 0.1,
        roughness: 0.5,
        flatShading: true,
    });
    root.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) m.material = mat;
    });
}

function fitCamera(camera: PerspectiveCamera, controls: OrbitControls, object: Group): void {
    const box = new Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
    const dist = maxDim * 2.2;
    camera.position.set(center.x + dist * 0.85, center.y + dist * 0.45, center.z + dist * 0.85);
    camera.near = maxDim / 200;
    camera.far = maxDim * 200;
    camera.updateProjectionMatrix();
    camera.lookAt(center);
    controls.target.copy(center);
    controls.update();
}

export function Scene3D({ mesh }: { mesh: SceneMeshPayload }) {
    const hostRef = useRef<HTMLDivElement>(null);
    const ctxRef = useRef<Ctx | null>(null);

    useEffect(() => {
        const el = hostRef.current;
        if (!el) return;

        ColorManagement.enabled = true;

        const scene = new Scene();
        /* Slightly cooler than page white so geometry separates on light UI */
        scene.background = new Color(0xd8e2ec);

        const camera = new PerspectiveCamera(45, 1, 0.00001, 500);
        const renderer = new WebGLRenderer({ antialias: true, alpha: false });
        renderer.outputColorSpace = SRGBColorSpace;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.domElement.style.display = "block";
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        el.appendChild(renderer.domElement);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.06;

        scene.add(new AmbientLight(0xffffff, 0.62));
        const key = new DirectionalLight(0xffffff, 1.05);
        key.position.set(3.5, 6, 4);
        scene.add(key);
        const fill = new DirectionalLight(0x94a3b8, 0.45);
        fill.position.set(-4, 2, -2);
        scene.add(fill);

        const content = new Group();
        scene.add(content);

        const resize = () => {
            const w = el.clientWidth;
            const h = el.clientHeight;
            if (w < 2 || h < 2) return;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        };
        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(el);

        let raf = 0;
        let alive = true;
        const loop = () => {
            if (!alive) return;
            raf = requestAnimationFrame(loop);
            controls.update();
            renderer.render(scene, camera);
        };
        raf = requestAnimationFrame(loop);

        ctxRef.current = { scene, camera, renderer, controls, content };

        return () => {
            alive = false;
            cancelAnimationFrame(raf);
            ro.disconnect();
            controls.dispose();
            renderer.dispose();
            el.removeChild(renderer.domElement);
            scene.clear();
            ctxRef.current = null;
        };
    }, []);

    useEffect(() => {
        const ctx = ctxRef.current;
        if (!ctx) return;

        for (const ch of [...ctx.content.children]) {
            disposeObject3D(ch);
            ctx.content.remove(ch);
        }

        if (!mesh || mesh.obj.trim() === "") return;

        try {
            const objBody = stripMtllib(mesh.obj);
            const mtlBody = mesh.mtl?.trim() ?? "";

            if (mtlBody.length > 0) {
                const mtlLoader = new MTLLoader();
                mtlLoader.setMaterialOptions({ side: DoubleSide });
                const materials = mtlLoader.parse(mtlBody, "");
                materials.preload();

                const objLoader = new OBJLoader();
                objLoader.setMaterials(materials);
                const root = objLoader.parse(objBody) as Group;
                ctx.content.add(root);
                fitCamera(ctx.camera, ctx.controls, root);
            } else {
                const loader = new OBJLoader();
                const root = loader.parse(objBody) as Group;
                applyFallbackMaterial(root);
                ctx.content.add(root);
                fitCamera(ctx.camera, ctx.controls, root);
            }
        } catch (e) {
            console.error(e);
        }
    }, [mesh]);

    return (
        <div
            ref={hostRef}
            class="three-host relative isolate w-full overflow-hidden rounded-box border border-base-300 bg-base-200 shadow-lg"
        />
    );
}
