// SAL Anomaly Dashboard — Steven's VR45to5 tide-only run
(function () {
  'use strict';

  var RUNS = [
    { key: 'steven-tide-only', label: "Steven's Tide Only", color: '#9467bd' },
  ];

  var DATA_PREFIX = 'data/steven/';

  // -----------------------------------------------------------------------
  // Map setup
  // -----------------------------------------------------------------------

  var map = L.map('map').setView([20, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 18,
  }).addTo(map);

  var selectedMarker = null;
  var markerLayer = L.layerGroup().addTo(map);
  var allStations = [];
  var markerById = {};
  var currentData = null;
  var TARGET_POINTS = 5000;
  var demeanEnabled = false;

  // -----------------------------------------------------------------------
  // Load stations and populate map
  // -----------------------------------------------------------------------

  fetch(DATA_PREFIX + 'stations.json')
    .then(function (r) { return r.json(); })
    .then(function (stations) {
      stations.forEach(function (stn) {
        var marker = L.circleMarker([stn.latitude, stn.longitude], {
          radius: 5,
          color: RUNS[0].color,
          fillColor: RUNS[0].color,
          fillOpacity: 0.8,
          weight: 1,
        });

        var popupHtml = '<b>' + stn.site_name + '</b>';
        if (stn.country) popupHtml += ' (' + stn.country + ')';

        marker.bindPopup(popupHtml);
        marker.on('click', function () { selectStation(stn.station_id, marker); });
        marker.stationId = stn.station_id;
        markerById[stn.station_id] = marker;
        markerLayer.addLayer(marker);
      });

      allStations = stations;
      addSearchControl();
    })
    .catch(function (err) {
      console.error('Failed to load stations.json:', err);
    });

  // -----------------------------------------------------------------------
  // Search control
  // -----------------------------------------------------------------------

  function addSearchControl() {
    var search = L.control({ position: 'topright' });
    search.onAdd = function () {
      var wrap = L.DomUtil.create('div', 'station-search');
      wrap.innerHTML =
        '<input type="text" id="station-search-input" placeholder="Search stations...">' +
        '<ul id="station-search-results"></ul>';
      L.DomEvent.disableClickPropagation(wrap);
      L.DomEvent.disableScrollPropagation(wrap);
      return wrap;
    };
    search.addTo(map);

    var input = document.getElementById('station-search-input');
    var resultsList = document.getElementById('station-search-results');

    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      resultsList.innerHTML = '';
      if (q.length < 2) return;
      var matches = allStations.filter(function (s) {
        return s.site_name.toLowerCase().indexOf(q) !== -1 ||
          (s.country && s.country.toLowerCase().indexOf(q) !== -1) ||
          s.station_id.toLowerCase().indexOf(q) !== -1;
      }).slice(0, 12);
      matches.forEach(function (s) {
        var li = document.createElement('li');
        li.textContent = s.site_name + (s.country ? ' (' + s.country + ')' : '');
        li.addEventListener('click', function () {
          resultsList.innerHTML = '';
          input.value = s.site_name;
          var marker = markerById[s.station_id];
          if (marker) {
            map.flyTo([s.latitude, s.longitude], 8, { duration: 0.8 });
            marker.openPopup();
            selectStation(s.station_id, marker);
          }
        });
        resultsList.appendChild(li);
      });
    });

    document.addEventListener('click', function (e) {
      if (!e.target.closest('.station-search')) resultsList.innerHTML = '';
    });
  }

  // -----------------------------------------------------------------------
  // Station selection
  // -----------------------------------------------------------------------

  function selectStation(stationId, marker) {
    if (selectedMarker) selectedMarker.setStyle({ weight: 1, radius: 5 });
    marker.setStyle({ weight: 3, radius: 8 });
    selectedMarker = marker;
    loadTimeseries(stationId);
    var controls = document.getElementById('plot-controls');
    if (controls) controls.style.display = '';
  }

  // -----------------------------------------------------------------------
  // Time series loading
  // -----------------------------------------------------------------------

  function loadTimeseries(stationId) {
    var panel = document.getElementById('timeseries-panel');
    var placeholder = panel.querySelector('.placeholder');
    var plotDiv = document.getElementById('timeseries-plot');

    if (placeholder) placeholder.style.display = 'none';
    plotDiv.innerHTML = '<p style="color:#6c757d;padding:1rem">Loading...</p>';

    fetch(DATA_PREFIX + 'timeseries/' + stationId + '.json')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) { renderTimeseries(data, plotDiv); })
      .catch(function (err) {
        plotDiv.innerHTML =
          '<p style="color:#d62728;padding:1rem">Failed to load time series: ' +
          err.message + '</p>';
      });
  }

  // -----------------------------------------------------------------------
  // LTTB downsampling
  // -----------------------------------------------------------------------

  function lttbIndices(y, target) {
    var n = y.length;
    if (target >= n || target < 3) {
      var all = new Array(n);
      for (var k = 0; k < n; k++) all[k] = k;
      return all;
    }
    var indices = [0];
    var bucketSize = (n - 2) / (target - 2);
    var prevIndex = 0;
    for (var i = 1; i < target - 1; i++) {
      var rangeStart = Math.floor((i - 1) * bucketSize) + 1;
      var rangeEnd = Math.min(Math.floor(i * bucketSize) + 1, n);
      var nextStart = Math.min(Math.floor(i * bucketSize) + 1, n - 1);
      var nextEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, n);
      var avgX = 0, avgY = 0, cnt = 0;
      for (var j = nextStart; j < nextEnd; j++) {
        if (y[j] !== null) { avgX += j; avgY += y[j]; cnt++; }
      }
      if (cnt > 0) { avgX /= cnt; avgY /= cnt; }
      var maxArea = -1, bestIdx = rangeStart;
      var pX = prevIndex, pY = y[prevIndex] || 0;
      for (var j = rangeStart; j < rangeEnd; j++) {
        if (y[j] === null) continue;
        var area = Math.abs((pX - avgX) * (y[j] - pY) - (pX - j) * (avgY - pY));
        if (area > maxArea) { maxArea = area; bestIdx = j; }
      }
      indices.push(bestIdx);
      prevIndex = bestIdx;
    }
    indices.push(n - 1);
    return indices;
  }

  function pickByIndices(arr, indices) {
    var out = new Array(indices.length);
    for (var i = 0; i < indices.length; i++) out[i] = arr[indices[i]];
    return out;
  }

  function mmToM(arr) {
    var out = new Array(arr.length);
    for (var i = 0; i < arr.length; i++) {
      out[i] = arr[i] !== null ? arr[i] / 1000 : null;
    }
    return out;
  }

  // -----------------------------------------------------------------------
  // Trace building
  // -----------------------------------------------------------------------

  function buildTracesForRange(data, startIdx, endIdx, target) {
    var n = endIdx - startIdx;
    var startMs = new Date(data.t0).getTime();
    var stepMs = data.dt_hours * 3600000;

    var primaryArr = data[RUNS[0].key] ? data[RUNS[0].key].slice(startIdx, endIdx) : null;
    var idx;
    if (primaryArr && n > target) {
      idx = lttbIndices(primaryArr, target);
    } else {
      idx = new Array(n);
      for (var k = 0; k < n; k++) idx[k] = k;
    }

    var times = new Array(idx.length);
    for (var i = 0; i < idx.length; i++) {
      times[i] = new Date(startMs + (startIdx + idx[i]) * stepMs)
        .toISOString().slice(0, 19);
    }

    var toM = (data.units === 'mm') ? mmToM : function(a) { return a; };

    function seriesMean(key) {
      var full = data[key];
      if (!full) return 0;
      var sum = 0, cnt = 0;
      for (var i = 0; i < full.length; i++) {
        if (full[i] !== null) { sum += full[i]; cnt++; }
      }
      return cnt > 0 ? sum / cnt : 0;
    }

    function applyScale(arr, meanRaw) {
      var out = toM(arr);
      if (!demeanEnabled) return out;
      var meanM = (data.units === 'mm') ? meanRaw / 1000 : meanRaw;
      for (var i = 0; i < out.length; i++) {
        if (out[i] !== null) out[i] -= meanM;
      }
      return out;
    }

    var traces = [];
    RUNS.forEach(function (r) {
      if (!data[r.key]) return;
      traces.push({
        x: times,
        y: applyScale(pickByIndices(data[r.key].slice(startIdx, endIdx), idx), seriesMean(r.key)),
        type: 'scattergl', mode: 'lines',
        name: r.label,
        line: { color: r.color, width: 1.5 },
        connectgaps: false,
        xaxis: 'x', yaxis: 'y',
      });
    });

    return traces;
  }

  function replot() {
    if (!currentData) return;
    renderTimeseries(currentData, document.getElementById('timeseries-plot'));
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  function renderTimeseries(data, plotDiv) {
    plotDiv.innerHTML = '';
    currentData = data;

    var traces = buildTracesForRange(data, 0, data.n, TARGET_POINTS);
    var title = data.site_name || data.station_id;
    if (data.country) title += ' (' + data.country + ')';

    var yLabel = demeanEnabled ? 'Sea level anomaly (m)' : 'Sea level (m)';

    var layout = {
      xaxis: { title: 'Date' },
      yaxis: { title: yLabel },
      title: { text: title, font: { size: 14 } },
      legend: { orientation: 'h', y: 1.08 },
      margin: { l: 60, r: 20, t: 60, b: 50 },
      template: 'plotly_white',
    };

    Plotly.newPlot(plotDiv, traces, layout, {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['lasso2d', 'select2d'],
    });

    plotDiv.on('plotly_relayout', function (evt) {
      if (!currentData) return;
      var xMin = evt['xaxis.range[0]'];
      var xMax = evt['xaxis.range[1]'];
      if (!xMin || !xMax) return;

      var startMs = new Date(currentData.t0).getTime();
      var stepMs = currentData.dt_hours * 3600000;
      var i0 = Math.max(0, Math.floor((new Date(xMin).getTime() - startMs) / stepMs));
      var i1 = Math.min(currentData.n, Math.ceil((new Date(xMax).getTime() - startMs) / stepMs));
      if (i1 <= i0) return;

      Plotly.react(plotDiv, buildTracesForRange(currentData, i0, i1, TARGET_POINTS),
        plotDiv.layout, { responsive: true, displaylogo: false,
          modeBarButtonsToRemove: ['lasso2d', 'select2d'] });
    });
  }

  // -----------------------------------------------------------------------
  // Demean toggle
  // -----------------------------------------------------------------------

  var demeanBox = document.getElementById('demean-toggle');
  if (demeanBox) {
    demeanBox.addEventListener('change', function () {
      demeanEnabled = demeanBox.checked;
      replot();
    });
  }

})();
