define(function(require, exports){

require('jquery');

var Loader = require('loader').Loader,
    Clock = require('clock').Clock,
    fixedstep = require('clock').fixedstep,
    glUtils = require('gl/utils'),
    InputHandler = require('input').Handler,
    MouseController = require('cameracontroller').MouseController,
    scene = require('gl/scene'),
    mesh = require('gl/mesh'),
    glutils = require('gl/utils'),
    FBO = require('gl/utils').FBO,
    glvoxel = require('gl/voxel'),
    voxel = require('voxel'),
    getHashValue = require('utils').getHashValue,
    vec2 = require('gl-matrix').vec2,
    vec3 = require('gl-matrix').vec3,
    vec4 = require('gl-matrix').vec4,
    mat4 = require('gl-matrix').mat4,
    Player = require('physics').Player,
    ShaderManager = require('gl/shader').Manager;


var RESOURCES = [
    'shaders/voxel.vertex',
    'shaders/voxel.frag',
    'shaders/blur.vertex',
    'shaders/blur.frag',
    'shaders/postprocess.vertex',
    'shaders/tonemap.frag',
    'shaders/solid.vertex',
    'shaders/solid.frag'
];

var loader = new Loader(),
    resources = loader.resources,
    shaders = new ShaderManager(resources),
    canvas = $('canvas')[0],
    input = new InputHandler(canvas),
    clock = new Clock(),
    graph = new scene.Graph(),
    mousecontroller = new MouseController(input, null),
    debug = getHashValue('debug', '0') !== '0',
    seed = getHashValue('seed', '0'),
    nogravity = getHashValue('nogravity', '0' !== '0'),
    debug_element = $('#debug'),
    camera, player;

var cube, cube2;
function prepareScene(){
    window.world = new voxel.World({width: 8, height: 4, depth: 8, chunk_size: 32, scale: 0.5});
    voxel.random_world(window.world, seed);
    //voxel.flat_world(window.world, 10);
    window.renderer = new glvoxel.Renderer(window.world);

    var albedoFBO = new FBO(canvas.width, canvas.height, gl.FLOAT),
        blurFBO0 = new FBO(canvas.width, canvas.height, gl.FLOAT),
        blurFBO1 = new FBO(canvas.width, canvas.height, gl.FLOAT),
        blurFBO2 = new FBO(canvas.width>>2, canvas.height>>2, gl.FLOAT),
        blurFBO3 = new FBO(canvas.width>>2, canvas.height>>2, gl.FLOAT);

    cube = new scene.Transform([
        new scene.Material(shaders.get('solid'), {color: vec4.create([0.5, 0.0, 0.0, 0.5])}, [
            new scene.SimpleMesh(new glUtils.VBO(mesh.cube(-0.5)))])
        ]);
    cube2 = new scene.Transform([
        new scene.Material(shaders.get('solid'), {color: vec4.create([0.0, 0.0, 1.0, 0.5])}, [
            new scene.SimpleMesh(new glUtils.VBO(mesh.cube(-0.5)))])
    ]);


    var shader = new scene.Material(shaders.get('voxel'), {}, [
            //new scene.SimpleMesh(new glutils.VBO(mesh.cube())),
            window.renderer
        ]);

    camera = new scene.Camera([
        new scene.RenderTarget(albedoFBO, [
            shader,
            cube
        ]),
        new scene.RenderTarget(blurFBO0, [
            new scene.Postprocess(shaders.get('blur.vertex', 'blur.frag'), {
                texture: albedoFBO,
                direction: vec2.create([1, 0]),
                size: vec2.create([albedoFBO.width, albedoFBO.height])
            })
        ]),
        new scene.RenderTarget(blurFBO1, [
            new scene.Postprocess(shaders.get('blur.vertex', 'blur.frag'), {
                texture: blurFBO0,
                direction: vec2.create([0, 1]),
                size: vec2.create([blurFBO0.width, blurFBO0.height])
            })
        ]),
        new scene.RenderTarget(blurFBO2, [
            new scene.Postprocess(shaders.get('blur.vertex', 'blur.frag'), {
                texture: blurFBO1,
                direction: vec2.create([1, 0]),
                size: vec2.create([blurFBO1.height, blurFBO1.width])
            })
        ]),
        new scene.RenderTarget(blurFBO3, [
            new scene.Postprocess(shaders.get('blur.vertex', 'blur.frag'), {
                texture: blurFBO2,
                direction: vec2.create([0, 1]),
                size: vec2.create([blurFBO2.width, blurFBO2.height])
            })
        ]),
        new scene.Postprocess(shaders.get('postprocess.vertex', 'tonemap.frag'), {
            blur0: blurFBO1,
            blur1: blurFBO3,
            albedo: albedoFBO
        }),
        //cube2
    ]);


    var globals = new scene.Uniforms({
            sunDirection: vec3.normalize(vec3.create([0.1, 0.3, 0.5]))
        }, [camera]);
    window.camera = camera;
    camera.position[0] = 4*32*0.5;
    camera.position[1] = 5*32*0.5;
    camera.position[2] = 8*32*0.5;
    player = new Player(window.world);
    player.setPosition(camera.position);
    camera.pitch = Math.PI*0.25;
    graph.root.append(globals);
    mousecontroller.camera = camera;
    mousecontroller.velocity = 20;
    gl.clearColor(0.1, 0.5, 0.98, 1.0);
    //gl.enable(gl.BLEND);
    //gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    graph.viewportWidth = canvas.width;
    graph.viewportHeight = canvas.height;
    return;
}

var add_block = false, delete_block = false, jetpack = false;
input.onKeyDown = function(key) {
    if(key === 'Q'){
        delete_block = true;
    }
    if(key === 'E'){
        add_block = true;
    }
};

window.cposition = vec3.create();
window.clposition = vec3.create();
var vel = 0.0;
clock.ontick = fixedstep(1/120, integrate, render);
    
function integrate(dt, t) {
    mousecontroller.tick(dt);

    player.acceleration = vec3.scale(vec3.subtract(camera.position, player.position, vec3.create()), 1.0/dt);

    if(input.keys.SPACE){
        player.acceleration[1] = 5;
    }
    else {
        player.acceleration[1] = -10;
    }
    if(!nogravity)
        player.acceleration[1] -= 10;

    vec3.scale(player.velocity, 0.99);

    player.tick(dt);
    vec3.set(player.position, camera.position);

    //debug_element.html('<h4>ray</h4>' +
                       //(hit ? 'hit' : 'miss') +
                       //'<br>' + Array.prototype.slice.call(ray).join(',') +
                       //'<br>' + Array.prototype.slice.call(window.cposition).join(',') +
                       //'<br>' + Array.prototype.slice.call(window.clposition).join(',') +
                       //'<br>' + voxel
                      //);
}
function render(dt, t){
    var ray = window.camera.getRay(),
        scale = window.world.scale;
    window.ray = ray;

    var hit = window.world.ray_query(ray, 1024, window.cposition, window.clposition),
        voxel = window.world.voxel(window.cposition);

    if(hit){
        mat4.identity(cube.matrix);
        mat4.translate(cube.matrix, vec3.add(window.clposition, [0.25, 0.25, 0.25]));
        mat4.scale(cube.matrix, vec3.create([0.5, 0.5, 0.5]));
        if(input.keys.Q) {
            delete_block = false;
            window.world.voxel(window.cposition, 0);
        }
        else if(add_block) {
            add_block = false;
            window.world.voxel(window.clposition, 3);
        }
    }

    graph.draw();
}

window.URL = window.URL || window.webkitURL;

if(glUtils.getContext(canvas, {}, {debug: debug, texture_float: true}) == null){
    $('#loading').hide();
    $('#video').show('slow');
}

loader.onready = function() {
    $('#loading .status').text('generating world');
    window.setTimeout(function () {
        prepareScene();
        $(canvas).show('slow', function(){
            clock.start(canvas);
            glUtils.fullscreen(canvas, graph, $('#cc')[0]);
        });
    }, 1);
};

loader.load(RESOURCES);

});
