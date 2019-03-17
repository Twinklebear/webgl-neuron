var cubeStrip = [
	1, 1, 0,
	0, 1, 0,
	1, 1, 1,
	0, 1, 1,
	0, 0, 1,
	0, 1, 0,
	0, 0, 0,
	1, 1, 0,
	1, 0, 0,
	1, 1, 1,
	1, 0, 1,
	0, 0, 1,
	1, 0, 0,
	0, 0, 0
];

var gl = null;

var neurons = [];
var swcShader = null;

var highlightTrace = null;
var showVolume = null;

var renderTargets = null;
var depthColorFbo = null
var colorFbo = null;
var blitImageShader = null;

var shader = null;
var volumeTexture = null;
var volumeVao = null;
var colormapTex = null;
var fileRegex = /.*\/(\w+)_(\d+)x(\d+)x(\d+)_(\w+)\.*/;
var proj = null;
var camera = null;
var projView = null;
var tabFocused = true;
var newVolumeUpload = true;
var targetFrameTime = 32;
var samplingRate = 1.0;
var WIDTH = 640;
var HEIGHT = 480;
const center = vec3.set(vec3.create(), 0.5, 0.5, 0.5);

var volumes = {
	"DIADEM NC Layer 1 Axons": "/04imux1qxpkilix/neocortical_layer_1_axons_1464x1033x76_uint8.raw",
};

var colormaps = {
	"Cool Warm": "colormaps/cool-warm-paraview.png",
	"Matplotlib Plasma": "colormaps/matplotlib-plasma.png",
	"Matplotlib Virdis": "colormaps/matplotlib-virdis.png",
	"Rainbow": "colormaps/rainbow.png",
	"Samsel Linear Green": "colormaps/samsel-linear-green.png",
	"Samsel Linear YGB 1211G": "colormaps/samsel-linear-ygb-1211g.png",
};

var loadVolume = function(file, onload) {
	var m = file.match(fileRegex);
	var volDims = [parseInt(m[2]), parseInt(m[3]), parseInt(m[4])];
	
	var url = "https://www.dl.dropboxusercontent.com/s/" + file + "?dl=1";
	var req = new XMLHttpRequest();
	var loadingProgressText = document.getElementById("loadingText");
	var loadingProgressBar = document.getElementById("loadingProgressBar");

	loadingProgressText.innerHTML = "Loading Volume";
	loadingProgressBar.setAttribute("style", "width: 0%");

	req.open("GET", url, true);
	req.responseType = "arraybuffer";
	req.onprogress = function(evt) {
		var vol_size = volDims[0] * volDims[1] * volDims[2];
		var percent = evt.loaded / vol_size * 100;
		loadingProgressBar.setAttribute("style", "width: " + percent.toFixed(2) + "%");
	};
	req.onerror = function(evt) {
		loadingProgressText.innerHTML = "Error Loading Volume";
		loadingProgressBar.setAttribute("style", "width: 0%");
	};
	req.onload = function(evt) {
		loadingProgressText.innerHTML = "Loaded Volume";
		loadingProgressBar.setAttribute("style", "width: 100%");
		var dataBuffer = req.response;
		if (dataBuffer) {
			dataBuffer = new Uint8Array(dataBuffer);
			onload(file, dataBuffer);
		} else {
			alert("Unable to load buffer properly from volume?");
			console.log("no buffer?");
		}
	};
	req.send();
}

var selectVolume = function() {
	var selection = document.getElementById("volumeList").value;
	history.replaceState(history.state, "#" + selection, "#" + selection);

	/*
	var url = "./diadem_nc_03.swc";
	var req = new XMLHttpRequest();
	req.open("GET", url, true);
	req.responseType = "text";
	req.onload = function(evt) {
		var text = req.response;
		if (text) {
			neurons.push(new SWCTree(text, "testing"));
		} else {
			alert("Unable to load text from SWC");
			console.log("no buffer?");
		}
	};
	req.send();
	*/

	loadVolume(volumes[selection], function(file, dataBuffer) {
		var m = file.match(fileRegex);
		var volDims = [parseInt(m[2]), parseInt(m[3]), parseInt(m[4])];

		var tex = gl.createTexture();
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_3D, tex);
		gl.texStorage3D(gl.TEXTURE_3D, 1, gl.R8, volDims[0], volDims[1], volDims[2]);
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0,
			volDims[0], volDims[1], volDims[2],
			gl.RED, gl.UNSIGNED_BYTE, dataBuffer);

		var longestAxis = Math.max(volDims[0], Math.max(volDims[1], volDims[2]));
		var volScale = [volDims[0] / longestAxis, volDims[1] / longestAxis,
			volDims[2] / longestAxis];

		gl.uniform3iv(shader.uniforms["volume_dims"], volDims);
		gl.uniform3fv(shader.uniforms["volume_scale"], volScale);

		newVolumeUpload = true;
		if (!volumeTexture) {
			volumeTexture = tex;
			setInterval(function() {
				// Save them some battery if they're not viewing the tab
				if (document.hidden) {
					return;
				}

				// Reset the sampling rate and camera for new volumes
				if (newVolumeUpload) {
					camera = new ArcballCamera(center, 2, [WIDTH, HEIGHT]);
					samplingRate = 1.0;
					gl.uniform1f(shader.uniforms["dt_scale"], samplingRate);
				}

				var startTime = new Date();

				projView = mat4.mul(projView, proj, camera.camera);
				var eye = [camera.invCamera[12], camera.invCamera[13], camera.invCamera[14]];

				// Render any SWC files we have
				gl.bindFramebuffer(gl.FRAMEBUFFER, depthColorFbo);
				gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
				gl.enable(gl.DEPTH_TEST);
				if (neurons.length > 0) {
					swcShader.use();
					gl.uniform3iv(swcShader.uniforms["volume_dims"], volDims);
					gl.uniform3fv(swcShader.uniforms["volume_scale"], volScale);
					gl.uniformMatrix4fv(swcShader.uniforms["proj_view"], false, projView);
					
					for (var i = 0; i < neurons.length; ++i) {
						var swc = neurons[i];
						if (!swc.visible.checked) {
							continue;
						}

						// Upload new SWC files
						if (swc.vao == null) {
							swc.vao = gl.createVertexArray();
							gl.bindVertexArray(swc.vao);

							swc.vbo = gl.createBuffer();
							gl.bindBuffer(gl.ARRAY_BUFFER, swc.vbo);
							gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(swc.points), gl.STATIC_DRAW);
							gl.enableVertexAttribArray(0);
							gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

							swc.ebo = gl.createBuffer();
							gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, swc.ebo);
							gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(swc.indices), gl.STATIC_DRAW);
						}

						var color = hexToRGB(swc.color.value);
						gl.uniform3fv(swcShader.uniforms["swc_color"], color);

						// Draw the SWC file
						gl.bindVertexArray(swc.vao);
						for (var j = 0; j < swc.branches.length; ++j) {
							var b = swc.branches[j];
							gl.drawElements(gl.LINE_STRIP, b["count"], gl.UNSIGNED_SHORT, 2 * b["start"]);
						}
					}
				}

				gl.bindFramebuffer(gl.FRAMEBUFFER, colorFbo);
				if (showVolume.checked) {
					gl.activeTexture(gl.TEXTURE4);
					gl.bindTexture(gl.TEXTURE_2D, renderTargets[1]);
					shader.use();
					gl.uniformMatrix4fv(shader.uniforms["proj_view"], false, projView);
					gl.uniformMatrix4fv(shader.uniforms["inv_proj"], false, invProj);

					var invView = mat4.invert(mat4.create(), camera.camera);
					gl.uniformMatrix4fv(shader.uniforms["inv_view"], false, invView);
					gl.uniform3fv(shader.uniforms["eye_pos"], eye);
					gl.uniform1i(shader.uniforms["highlight_trace"], highlightTrace.checked);

					gl.bindVertexArray(volumeVao);
					gl.drawArrays(gl.TRIANGLE_STRIP, 0, cubeStrip.length / 3);
				}

				// Seems like we can't blit the framebuffer b/c the default draw fbo might be
				// using multiple samples?
				gl.bindFramebuffer(gl.FRAMEBUFFER, null);
				gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
				gl.disable(gl.BLEND);
				gl.disable(gl.CULL_FACE);
				blitImageShader.use();
				gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
				gl.enable(gl.CULL_FACE);
				gl.enable(gl.BLEND);

				// Wait for rendering to actually finish
				gl.finish();
				var endTime = new Date();
				var renderTime = endTime - startTime;
				var targetSamplingRate = renderTime / targetFrameTime;

				// If we're dropping frames, decrease the sampling rate
				if (!newVolumeUpload && targetSamplingRate > samplingRate) {
					samplingRate = 0.5 * samplingRate + 0.5 * targetSamplingRate;
					gl.uniform1f(shader.uniforms["dt_scale"], samplingRate);
				}
				newVolumeUpload = false;
				startTime = endTime;
			}, targetFrameTime);
		} else {
			gl.deleteTexture(volumeTexture);
			volumeTexture = tex;
		}
	});
}

var selectColormap = function() {
	var selection = document.getElementById("colormapList").value;
	var colormapImage = new Image();
	colormapImage.onload = function() {
		gl.activeTexture(gl.TEXTURE1);
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 180, 1,
			gl.RGBA, gl.UNSIGNED_BYTE, colormapImage);
	};
	colormapImage.src = colormaps[selection];
}

window.onload = function(){
	fillVolumeSelector();
	fillcolormapSelector();

	highlightTrace = document.getElementById("highlightTrace");
	showVolume = document.getElementById("showVolume");
	showVolume.checked = true;

	var canvas = document.getElementById("glcanvas");
	gl = canvas.getContext("webgl2");
	if (!gl) {
		alert("Unable to initialize WebGL2. Your browser may not support it");
		return;
	}
	WIDTH = canvas.getAttribute("width");
	HEIGHT = canvas.getAttribute("height");

	proj = mat4.perspective(mat4.create(), 60 * Math.PI / 180.0,
		WIDTH / HEIGHT, 0.1, 100);
	invProj = mat4.invert(mat4.create(), proj);

	camera = new ArcballCamera(center, 2, [WIDTH, HEIGHT]);
	projView = mat4.create();

	// Register mouse and touch listeners
	var controller = new Controller();
	controller.mousemove = function(prev, cur, evt) {
		if (evt.buttons == 1) {
			camera.rotate(prev, cur);

		} else if (evt.buttons == 2) {
			camera.pan([cur[0] - prev[0], prev[1] - cur[1]]);
		}
	};
	controller.wheel = function(amt) { camera.zoom(amt); };
	controller.pinch = controller.wheel;
	controller.twoFingerDrag = function(drag) { camera.pan(drag); };

	controller.registerForCanvas(canvas);

	// Setup VAO and VBO to render the cube to run the raymarching shader
	volumeVao = gl.createVertexArray();
	gl.bindVertexArray(volumeVao);

	var vbo = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(cubeStrip), gl.STATIC_DRAW);

	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

	blitImageShader = new Shader(quadVertShader, quadFragShader);
	blitImageShader.use();
	gl.uniform1i(blitImageShader.uniforms["colors"], 3);

	swcShader = new Shader(swcVertShader, swcFragShader);

	shader = new Shader(vertShader, fragShader);
	shader.use();

	gl.uniform1i(shader.uniforms["volume"], 0);
	gl.uniform1i(shader.uniforms["colormap"], 1);
	gl.uniform1i(shader.uniforms["depth"], 4);
	gl.uniform1f(shader.uniforms["dt_scale"], 1.0);

	// Setup required OpenGL state for drawing the back faces and
	// composting with the background color
	gl.enable(gl.CULL_FACE);
	gl.cullFace(gl.FRONT);
	gl.enable(gl.BLEND);
	gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

	gl.clearColor(0.0, 0.0, 0.0, 0.0);
	gl.clearDepth(1.0);

	// Setup the render targets for the splat rendering pass
	renderTargets = [gl.createTexture(), gl.createTexture()]
	gl.bindTexture(gl.TEXTURE_2D, renderTargets[0]);
	gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, WIDTH, HEIGHT);

	gl.bindTexture(gl.TEXTURE_2D, renderTargets[1]);
	gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT32F, WIDTH, HEIGHT);
	//gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH24_STENCIL8, WIDTH, HEIGHT);

	for (var i = 0; i < 2; ++i) {
		gl.bindTexture(gl.TEXTURE_2D, renderTargets[i]);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	}

	gl.activeTexture(gl.TEXTURE3);
	gl.bindTexture(gl.TEXTURE_2D, renderTargets[0]);
	gl.activeTexture(gl.TEXTURE4);
	gl.bindTexture(gl.TEXTURE_2D, renderTargets[1]);

	depthColorFbo = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, depthColorFbo);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
		gl.TEXTURE_2D, renderTargets[0], 0);
	//gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT,
	//	gl.TEXTURE_2D, renderTargets[1], 0);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,
		gl.TEXTURE_2D, renderTargets[1], 0);
	gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

	colorFbo = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, colorFbo);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
		gl.TEXTURE_2D, renderTargets[0], 0);
	gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

	// See if we were linked to a datset
	if (window.location.hash) {
		var linkedDataset = decodeURI(window.location.hash.substr(1));
		if (linkedDataset in volumes) {
			document.getElementById("volumeList").value = linkedDataset;
		}
	}

	// Load the default colormap and upload it, after which we
	// load the default volume.
	var colormapImage = new Image();
	colormapImage.onload = function() {
		var colormap = gl.createTexture();
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, colormap);
		gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 180, 1);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 180, 1,
			gl.RGBA, gl.UNSIGNED_BYTE, colormapImage);

		selectVolume();
	};
	colormapImage.src = "colormaps/cool-warm-paraview.png";
}

var hexToRGB = function(hex) {
	var val = parseInt(hex.substr(1), 16);
	var r = (val >> 16) & 255;
	var g = (val >> 8) & 255;
	var b = val & 255;
	return [r / 255.0, g / 255.0, b / 255.0];
}

var fillVolumeSelector = function() {
	var selector = document.getElementById("volumeList");
	for (v in volumes) {
		var opt = document.createElement("option");
		opt.value = v;
		opt.innerHTML = v;
		selector.appendChild(opt);
	}
}

var fillcolormapSelector = function() {
	var selector = document.getElementById("colormapList");
	for (p in colormaps) {
		var opt = document.createElement("option");
		opt.value = p;
		opt.innerHTML = p;
		selector.appendChild(opt);
	}
}

// Load up the SWC files the user gave us
var uploadSWC = function(files) {
	var swcList = document.getElementById("swcList");
	for (var i = 0; i < files.length; ++i) {
		var file = files[i];
		var reader = new FileReader();
		reader.onerror = function() {
			alert("Error reading file " + file.name);
		};
		reader.onload = function(evt) {
			var text = reader.result;
			if (text) {
				var swc = new SWCTree(text, file.name);
				addSWCFile(swc);
			} else {
				alert("Unable to load file " + file.name);
			}
		};
		reader.readAsText(file);
	}
}

var colorBrewerColors = [
	"#a6cee3", "#1f78b4", "#b2df8a", "#33a02c", "#fb9a99",
	"#e31a1c", "#fdbf6f", "#ff7f00", "#cab2d6", "#6a3d9a"
];
/*
var colorBrewerColors = [
	"#66c2a5", "#fc8d62", "#8da0cb", "#e78ac3", "#a6d854",
	"#ffd92f", "#e5c494", "#b3b3b3"
];
*/
var nextSWCColor = 0;

var addSWCFile = function(swc) {
	var swcHTMLContent = `
	<div class="col-12 mt-2 mb-2" id="swc">
		<div class="row">
			<div class="col-4">
				${swc.name}
			</div>
			<div class="col-4 text-right" id="numBranches">
				${swc.branches.length}
			</div>
			<div class="col-4 text-right" id="numPoints">
				${swc.points.length / 3}
			</div>
		</div>
		<div class="form-row">
			<div class="col-6 text-center">
				<input type="checkbox" class="form-check-input"
						id="traceVisible${neurons.length}">
				<label class="form-check-label" for="traceVisible${neurons.length}">
					Visible</label>
			</div>
			<div class="col-6 text-center">
				<label for="swcColor${neurons.length}">Color</label>
				<input type="color" class="form-control" value="#ff0000"
						id="swcColor${neurons.length}">
			</div>
		</div>
		<hr>
	</div>
	`
	swcList.insertAdjacentHTML("beforeend", swcHTMLContent);

	swc.visible = document.getElementById("traceVisible" + neurons.length);
	swc.visible.checked = true;
	swc.color = document.getElementById("swcColor" + neurons.length);
	swc.color.value = colorBrewerColors[nextSWCColor];
	nextSWCColor = (nextSWCColor + 1) % colorBrewerColors.length;

	neurons.push(swc);
}

