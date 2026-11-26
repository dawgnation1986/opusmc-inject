'use strict';
OpusMC._prelude("create", {"ids": {"blocks": {"create_andesite_casing": 4097, "create_shaft": 4098, "create_cogwheel": 4099, "create_large_cogwheel": 4100, "create_water_wheel": 4101, "create_windmill_bearing": 4102, "create_hand_crank": 4103, "create_creative_motor": 4104, "create_mechanical_press": 4105, "create_millstone": 4106, "create_mechanical_saw": 4107, "create_mechanical_mixer": 4108, "create_zinc_ore": 4109, "create_brass_casing": 4110, "create_copper_casing": 4111, "create_white_sail": 4112}, "items": {"create_andesite_casing": 4097, "create_shaft": 4098, "create_cogwheel": 4099, "create_large_cogwheel": 4100, "create_water_wheel": 4101, "create_windmill_bearing": 4102, "create_hand_crank": 4103, "create_creative_motor": 4104, "create_mechanical_press": 4105, "create_millstone": 4106, "create_mechanical_saw": 4107, "create_mechanical_mixer": 4108, "create_zinc_ore": 4109, "create_brass_casing": 4110, "create_copper_casing": 4111, "create_white_sail": 4112, "create_andesite_alloy": 10001, "create_iron_sheet": 10002, "create_copper_sheet": 10003, "create_golden_sheet": 10004, "create_brass_ingot": 10005, "create_brass_sheet": 10006, "create_zinc_ingot": 10007, "create_raw_zinc": 10008, "create_wheat_flour": 10009, "create_goggles": 10010, "create_brass_nugget": 10011, "create_zinc_nugget": 10012, "create_precision_mechanism": 10013, "create_sturdy_sheet": 10014}}, "textures": ["andesite_alloy", "andesite_casing", "andesite_casing_short", "axis", "axis_top", "bearing_top", "brass_casing", "brass_ingot", "brass_nugget", "brass_sheet", "cogwheel", "cogwheel_axis", "copper_casing", "copper_sheet", "creative_casing", "creative_motor", "encased_chain_drive", "flap_display_front", "funnel_andesite_funnel_frame", "gearbox", "gearbox_top", "goggles", "golden_sheet", "iron_sheet", "large_cogwheel", "mechanical_press_bottom", "mechanical_press_head", "mechanical_press_pole", "mechanical_press_side", "mechanical_press_top", "mechanical_saw_top_no_slot", "millstone", "mixer_base_side", "mixer_head", "precision_mechanism", "raw_zinc", "sail_canvas_white", "sail_frame", "smooth_dark_log_top", "static_saw", "sturdy_sheet", "waterwheel_metal", "wheat_flour", "windmill_bearing", "zinc_ingot", "zinc_nugget", "zinc_ore"], "version": "1.2.0"});
// ===========================================================================
// 机械动力（Create）网页移植版 · 内容层
//
// 贴图：全部取自 Create 官方仓库（mc1.20.1/dev）assets/create/textures，
//       由 _build/mktextures.py 降采样成 16×16，见 textures/
// 模型：直接转 Create 的 block model JSON（_build/mkmodel.py -> models.js），
//       不是手搓形状；压机/石磨/锯/搅拌器/曲柄/马达/齿轮都是原版 elements
// 编号：由 _build/mkprelude.py 生成，不要手改
// ===========================================================================

// ==== MODELS BEGIN ==== 由 _build/mkmodel.py 生成，不要手改
const CREATE_MODELS = {"shaft":{"elements":[{"from":[6.0,0.0,6.0],"to":[10.0,16.0,10.0],"faces":{"north":{"texture":"axis","uv":[6.0,0.0,10.0,16.0]},"east":{"texture":"axis","uv":[6.0,0.0,10.0,16.0]},"south":{"texture":"axis","uv":[6.0,0.0,10.0,16.0]},"west":{"texture":"axis","uv":[6.0,0.0,10.0,16.0]},"up":{"texture":"axis_top","uv":[6.0,6.0,10.0,10.0]},"down":{"texture":"axis_top","uv":[6.0,6.0,10.0,10.0]}}}]},"cogwheel":{"elements":[{"from":[6,0,6],"to":[10,16,10],"faces":{"north":{"texture":"cogwheel_axis","uv":[6,0,10,16]},"east":{"texture":"cogwheel_axis","uv":[6,0,10,16]},"south":{"texture":"cogwheel_axis","uv":[6,0,10,16]},"west":{"texture":"cogwheel_axis","uv":[6,0,10,16]},"up":{"texture":"axis_top","uv":[6,6,10,10]},"down":{"texture":"axis_top","uv":[6,6,10,10]}}},{"from":[-1,6.5,6.5],"to":[17,9.5,9.5],"faces":{"north":{"texture":"cogwheel","uv":[7,8,16,9.5]},"east":{"texture":"cogwheel","uv":[5,8,6.5,9.5]},"south":{"texture":"cogwheel","uv":[7,8,16,9.5]},"west":{"texture":"cogwheel","uv":[5,8,6.5,9.5]},"up":{"texture":"cogwheel","uv":[7,6,16,7.5]},"down":{"texture":"cogwheel","uv":[7,6,16,7.5]}}},{"from":[-1,6.5,6.5],"to":[17,9.5,9.5],"faces":{"north":{"texture":"cogwheel","uv":[7,8,16,9.5]},"east":{"texture":"cogwheel","uv":[5,8,6.5,9.5]},"south":{"texture":"cogwheel","uv":[7,8,16,9.5]},"west":{"texture":"cogwheel","uv":[5,8,6.5,9.5]},"up":{"texture":"cogwheel","uv":[7,6,16,7.5]},"down":{"texture":"cogwheel","uv":[7,6,16,7.5]}},"rotation":{"origin":[8,8,8],"axis":"y","angle":45,"rescale":false}},{"from":[-1,6.5,6.5],"to":[17,9.5,9.5],"faces":{"north":{"texture":"cogwheel","uv":[7,8,16,9.5]},"east":{"texture":"cogwheel","uv":[5,8,6.5,9.5]},"south":{"texture":"cogwheel","uv":[7,8,16,9.5]},"west":{"texture":"cogwheel","uv":[5,8,6.5,9.5]},"up":{"texture":"cogwheel","uv":[7,6,16,7.5]},"down":{"texture":"cogwheel","uv":[7,6,16,7.5]}},"rotation":{"origin":[8,8,8],"axis":"y","angle":-45,"rescale":false}},{"from":[6.5,6.5,-1],"to":[9.5,9.5,17],"faces":{"north":{"texture":"cogwheel","uv":[5,8,6.5,9.5]},"east":{"texture":"cogwheel","uv":[7,8,16,9.5]},"south":{"texture":"cogwheel","uv":[5,8,6.5,9.5]},"west":{"texture":"cogwheel","uv":[7,8,16,9.5]},"up":{"texture":"cogwheel","uv":[7,6,16,7.5],"rotation":90},"down":{"texture":"cogwheel","uv":[7,6,16,7.5],"rotation":90}}},{"from":[2,6.55,2],"to":[14,9.45,14],"faces":{"north":{"texture":"cogwheel","uv":[0,6,6,7.5]},"east":{"texture":"cogwheel","uv":[0,6,6,7.5]},"south":{"texture":"cogwheel","uv":[0,6,6,7.5]},"west":{"texture":"cogwheel","uv":[0,6,6,7.5]},"up":{"texture":"cogwheel","uv":[4,0,10,6]},"down":{"texture":"cogwheel","uv":[4,0,10,6]}}},{"from":[4,6,4],"to":[12,10,12],"faces":{"north":{"texture":"cogwheel","uv":[0,4,4,6]},"east":{"texture":"cogwheel","uv":[0,4,4,6]},"south":{"texture":"cogwheel","uv":[0,4,4,6]},"west":{"texture":"cogwheel","uv":[0,4,4,6]},"up":{"texture":"cogwheel","uv":[0,0,4,4]},"down":{"texture":"cogwheel","uv":[0,0,4,4]}}}]},"large_cogwheel":{"elements":[{"from":[-2,6.625,-2],"to":[18,9.375,18],"faces":{"north":{"texture":"large_cogwheel","uv":[0,10,10,11.5]},"east":{"texture":"large_cogwheel","uv":[0,10,10,11.5]},"south":{"texture":"large_cogwheel","uv":[0,10,10,11.5]},"west":{"texture":"large_cogwheel","uv":[0,10,10,11.5]},"up":{"texture":"large_cogwheel","uv":[0,0,10,10]},"down":{"texture":"large_cogwheel","uv":[0,0,10,10]}},"rotation":{"origin":[8,8,8],"axis":"y","angle":45,"rescale":false}},{"from":[6,0,6],"to":[10,16,10],"faces":{"north":{"texture":"cogwheel_axis","uv":[6,0,10,16]},"east":{"texture":"cogwheel_axis","uv":[6,0,10,16]},"south":{"texture":"cogwheel_axis","uv":[6,0,10,16]},"west":{"texture":"cogwheel_axis","uv":[6,0,10,16]},"up":{"texture":"axis_top","uv":[6,6,10,10]},"down":{"texture":"axis_top","uv":[6,6,10,10]}}},{"from":[-7,6.525,6.5],"to":[23,9.475,9.5],"faces":{"north":{"texture":"large_cogwheel","uv":[0,13,15,14.5]},"east":{"texture":"large_cogwheel","uv":[10,9.5,11.5,11]},"south":{"texture":"large_cogwheel","uv":[0,13,15,14.5]},"west":{"texture":"large_cogwheel","uv":[10,9.5,11.5,11]},"up":{"texture":"large_cogwheel","uv":[0,11.5,15,13]},"down":{"texture":"large_cogwheel","uv":[0,11.5,15,13]}},"rotation":{"origin":[8,8,8],"axis":"y","angle":22.5,"rescale":false}},{"from":[-7,6.525,6.5],"to":[23,9.475,9.5],"faces":{"north":{"texture":"large_cogwheel","uv":[0,13,15,14.5]},"east":{"texture":"large_cogwheel","uv":[10,9.5,11.5,11]},"south":{"texture":"large_cogwheel","uv":[0,13,15,14.5]},"west":{"texture":"large_cogwheel","uv":[10,9.5,11.5,11]},"up":{"texture":"large_cogwheel","uv":[0,11.5,15,13]},"down":{"texture":"large_cogwheel","uv":[0,11.5,15,13]}},"rotation":{"origin":[8,8,8],"axis":"y","angle":-22.5,"rescale":false}},{"from":[6.5,6.525,-7],"to":[9.5,9.475,23],"faces":{"north":{"texture":"large_cogwheel","uv":[10,9.5,11.5,11]},"east":{"texture":"large_cogwheel","uv":[0,13,15,14.5]},"south":{"texture":"large_cogwheel","uv":[10,9.5,11.5,11]},"west":{"texture":"large_cogwheel","uv":[0,13,15,14.5]},"up":{"texture":"large_cogwheel","uv":[0,11.5,15,13],"rotation":90},"down":{"texture":"large_cogwheel","uv":[0,11.5,15,13],"rotation":90}},"rotation":{"origin":[8,8,8],"axis":"y","angle":22.5,"rescale":false}},{"from":[-2,6.6,-2],"to":[18,9.4,18],"faces":{"north":{"texture":"large_cogwheel","uv":[0,10,10,11.5]},"east":{"texture":"large_cogwheel","uv":[0,10,10,11.5]},"south":{"texture":"large_cogwheel","uv":[0,10,10,11.5]},"west":{"texture":"large_cogwheel","uv":[0,10,10,11.5]},"up":{"texture":"large_cogwheel","uv":[0,0,10,10]},"down":{"texture":"large_cogwheel","uv":[0,0,10,10]}}},{"from":[1,5.975,1],"to":[15,10.025,15],"faces":{"north":{"texture":"large_cogwheel","uv":[10,0,12.5,7],"rotation":90},"east":{"texture":"large_cogwheel","uv":[10,0,12.5,7],"rotation":90},"south":{"texture":"large_cogwheel","uv":[10,0,12.5,7],"rotation":90},"west":{"texture":"large_cogwheel","uv":[10,0,12.5,7],"rotation":90},"up":{"texture":"large_cogwheel","uv":[1.5,1.5,8.5,8.5]},"down":{"texture":"large_cogwheel","uv":[1.5,1.5,8.5,8.5]}}},{"from":[-1,5.975,1],"to":[1,10.025,15],"faces":{"north":{"texture":"large_cogwheel","uv":[10,0,11,1],"rotation":90},"south":{"texture":"large_cogwheel","uv":[10,6,11,7],"rotation":90},"west":{"texture":"large_cogwheel","uv":[10,0,11,7],"rotation":90},"up":{"texture":"large_cogwheel","uv":[12,0,13,7],"rotation":180},"down":{"texture":"large_cogwheel","uv":[13,0,14,7],"rotation":180}},"rotation":{"origin":[8,8,8],"axis":"y","angle":0,"rescale":false}},{"from":[1,5.975,-1],"to":[15,10.025,1],"faces":{"north":{"texture":"large_cogwheel","uv":[10,0,11,7],"rotation":90},"east":{"texture":"large_cogwheel","uv":[10,0,11,1],"rotation":90},"west":{"texture":"large_cogwheel","uv":[10,6,11,7],"rotation":90},"up":{"texture":"large_cogwheel","uv":[13,0,14,7],"rotation":270},"down":{"texture":"large_cogwheel","uv":[12,0,13,7],"rotation":90}},"rotation":{"origin":[8,8,8],"axis":"y","angle":0,"rescale":false}},{"from":[15,5.975,1],"to":[17,10.025,15],"faces":{"north":{"texture":"large_cogwheel","uv":[10,6,11,7],"rotation":90},"east":{"texture":"large_cogwheel","uv":[10,0,11,7],"rotation":90},"south":{"texture":"large_cogwheel","uv":[10,0,11,1],"rotation":90},"up":{"texture":"large_cogwheel","uv":[15,0,16,7]},"down":{"texture":"large_cogwheel","uv":[14,0,15,7]}},"rotation":{"origin":[8,8,8],"axis":"y","angle":0,"rescale":false}},{"from":[1,5.975,15],"to":[15,10.025,17],"faces":{"east":{"texture":"large_cogwheel","uv":[10,6,11,7],"rotation":90},"south":{"texture":"large_cogwheel","uv":[10,0,11,7],"rotation":90},"west":{"texture":"large_cogwheel","uv":[10,0,11,1],"rotation":90},"up":{"texture":"large_cogwheel","uv":[14,0,15,7],"rotation":90},"down":{"texture":"large_cogwheel","uv":[15,0,16,7],"rotation":270}},"rotation":{"origin":[8,8,8],"axis":"y","angle":0,"rescale":false}},{"from":[6.5,6.525,-7],"to":[9.5,9.475,23],"faces":{"north":{"texture":"large_cogwheel","uv":[10,9.5,11.5,11]},"east":{"texture":"large_cogwheel","uv":[0,13,15,14.5]},"south":{"texture":"large_cogwheel","uv":[10,9.5,11.5,11]},"west":{"texture":"large_cogwheel","uv":[0,13,15,14.5]},"up":{"texture":"large_cogwheel","uv":[0,11.5,15,13],"rotation":90},"down":{"texture":"large_cogwheel","uv":[0,11.5,15,13],"rotation":90}},"rotation":{"origin":[8,8,8],"axis":"y","angle":-22.5,"rescale":false}},{"from":[-7,6.525,6.5],"to":[23,9.475,9.5],"faces":{"north":{"texture":"large_cogwheel","uv":[0,13,15,14.5]},"east":{"texture":"large_cogwheel","uv":[10,9.5,11.5,11]},"south":{"texture":"large_cogwheel","uv":[0,13,15,14.5]},"west":{"texture":"large_cogwheel","uv":[10,9.5,11.5,11]},"up":{"texture":"large_cogwheel","uv":[0,11.5,15,13]},"down":{"texture":"large_cogwheel","uv":[0,11.5,15,13]}},"rotation":{"origin":[8,8,8],"axis":"y","angle":45,"rescale":false}},{"from":[6.5,6.525,-7],"to":[9.5,9.475,23],"faces":{"north":{"texture":"large_cogwheel","uv":[10,9.5,11.5,11]},"east":{"texture":"large_cogwheel","uv":[0,13,15,14.5]},"south":{"texture":"large_cogwheel","uv":[10,9.5,11.5,11]},"west":{"texture":"large_cogwheel","uv":[0,13,15,14.5]},"up":{"texture":"large_cogwheel","uv":[0,11.5,15,13],"rotation":90},"down":{"texture":"large_cogwheel","uv":[0,11.5,15,13],"rotation":90}},"rotation":{"origin":[8,8,8],"axis":"y","angle":45,"rescale":false}},{"from":[-7,6.525,6.5],"to":[23,9.475,9.5],"faces":{"north":{"texture":"large_cogwheel","uv":[0,13,15,14.5]},"east":{"texture":"large_cogwheel","uv":[10,9.5,11.5,11]},"south":{"texture":"large_cogwheel","uv":[0,13,15,14.5]},"west":{"texture":"large_cogwheel","uv":[10,9.5,11.5,11]},"up":{"texture":"large_cogwheel","uv":[0,11.5,15,13]},"down":{"texture":"large_cogwheel","uv":[0,11.5,15,13]}}},{"from":[6.5,6.525,-7],"to":[9.5,9.475,23],"faces":{"north":{"texture":"large_cogwheel","uv":[10,9.5,11.5,11]},"east":{"texture":"large_cogwheel","uv":[0,13,15,14.5]},"south":{"texture":"large_cogwheel","uv":[10,9.5,11.5,11]},"west":{"texture":"large_cogwheel","uv":[0,13,15,14.5]},"up":{"texture":"large_cogwheel","uv":[0,11.5,15,13],"rotation":90},"down":{"texture":"large_cogwheel","uv":[0,11.5,15,13],"rotation":90}}}]},"water_wheel":{"elements":[{"from":[1.95,1,1.95],"to":[14.05,0,14.05],"faces":{"north":{"texture":"gearbox","uv":[2,0,14,1],"rotation":180},"east":{"texture":"gearbox","uv":[0,2,1,14],"rotation":90},"south":{"texture":"gearbox","uv":[2,15,14,16]},"west":{"texture":"gearbox","uv":[15,2,16,14],"rotation":270},"down":{"texture":"gearbox","uv":[2,2,14,14],"rotation":180}}},{"from":[1.95,16,1.95],"to":[14.05,15,14.05],"faces":{"north":{"texture":"gearbox","uv":[2,0,14,1]},"east":{"texture":"gearbox","uv":[15,2,16,14],"rotation":90},"south":{"texture":"gearbox","uv":[2,15,14,16],"rotation":180},"west":{"texture":"gearbox","uv":[0,2,1,14],"rotation":270},"up":{"texture":"gearbox","uv":[2,2,14,14]}}},{"from":[2,2,2],"to":[14,14,14],"faces":{"north":{"texture":"gearbox","uv":[6,6,10,10],"rotation":180},"east":{"texture":"gearbox","uv":[6,6,10,10],"rotation":90},"south":{"texture":"gearbox","uv":[6,6,10,10]},"west":{"texture":"gearbox","uv":[6,6,10,10],"rotation":270}}},{"from":[0,14,0],"to":[16,16,16],"faces":{"north":{"texture":"funnel_andesite_funnel_frame","uv":[0,0,16,2]},"east":{"texture":"funnel_andesite_funnel_frame","uv":[0,0,16,2]},"south":{"texture":"funnel_andesite_funnel_frame","uv":[0,0,16,2]},"west":{"texture":"funnel_andesite_funnel_frame","uv":[0,0,16,2]},"up":{"texture":"funnel_andesite_funnel_frame","uv":[0,0,16,16]},"down":{"texture":"gearbox","uv":[0,0,16,16]}}},{"from":[0,0,0],"to":[16,2,16],"faces":{"north":{"texture":"funnel_andesite_funnel_frame","uv":[0,0,16,2],"rotation":180},"east":{"texture":"funnel_andesite_funnel_frame","uv":[0,0,16,2],"rotation":180},"south":{"texture":"funnel_andesite_funnel_frame","uv":[0,0,16,2],"rotation":180},"west":{"texture":"funnel_andesite_funnel_frame","uv":[0,0,16,2],"rotation":180},"up":{"texture":"gearbox","uv":[0,0,16,16]},"down":{"texture":"funnel_andesite_funnel_frame","uv":[0,0,16,16]}}},{"from":[1.5,7.4,6.8],"to":[14.5,8.6,9.2],"rotation":{"origin":[8,8,8],"axis":"z","angle":-45,"rescale":false},"faces":{"north":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"south":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"up":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"down":{"texture":"waterwheel_metal","uv":[0,0,16,16]}}},{"from":[1.5,7.4,6.8],"to":[14.5,8.6,9.2],"rotation":{"origin":[8,8,8],"axis":"z","angle":-22.5,"rescale":false},"faces":{"north":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"south":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"up":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"down":{"texture":"waterwheel_metal","uv":[0,0,16,16]}}},{"from":[1.5,7.4,6.8],"to":[14.5,8.6,9.2],"rotation":{"origin":[8,8,8],"axis":"z","angle":0,"rescale":false},"faces":{"north":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"south":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"up":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"down":{"texture":"waterwheel_metal","uv":[0,0,16,16]}}},{"from":[1.5,7.4,6.8],"to":[14.5,8.6,9.2],"rotation":{"origin":[8,8,8],"axis":"z","angle":22.5,"rescale":false},"faces":{"north":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"south":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"up":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"down":{"texture":"waterwheel_metal","uv":[0,0,16,16]}}},{"from":[1.5,7.4,6.8],"to":[14.5,8.6,9.2],"rotation":{"origin":[8,8,8],"axis":"z","angle":45,"rescale":false},"faces":{"north":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"south":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"up":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"down":{"texture":"waterwheel_metal","uv":[0,0,16,16]}}},{"from":[13.2,5.6,6.2],"to":[15.8,10.4,9.8],"rotation":{"origin":[8,8,8],"axis":"z","angle":-45,"rescale":false},"faces":{"north":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"south":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"east":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"west":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"up":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"down":{"texture":"waterwheel_metal","uv":[0,0,16,16]}}},{"from":[13.2,5.6,6.2],"to":[15.8,10.4,9.8],"rotation":{"origin":[8,8,8],"axis":"z","angle":-15,"rescale":false},"faces":{"north":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"south":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"east":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"west":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"up":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"down":{"texture":"waterwheel_metal","uv":[0,0,16,16]}}},{"from":[13.2,5.6,6.2],"to":[15.8,10.4,9.8],"rotation":{"origin":[8,8,8],"axis":"z","angle":15,"rescale":false},"faces":{"north":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"south":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"east":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"west":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"up":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"down":{"texture":"waterwheel_metal","uv":[0,0,16,16]}}},{"from":[13.2,5.6,6.2],"to":[15.8,10.4,9.8],"rotation":{"origin":[8,8,8],"axis":"z","angle":45,"rescale":false},"faces":{"north":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"south":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"east":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"west":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"up":{"texture":"waterwheel_metal","uv":[0,0,16,16]},"down":{"texture":"waterwheel_metal","uv":[0,0,16,16]}}},{"from":[6.5,6.5,6.5],"to":[9.5,9.5,9.5],"faces":{"north":{"texture":"axis_top","uv":[0,0,16,16]},"south":{"texture":"axis_top","uv":[0,0,16,16]},"up":{"texture":"axis","uv":[0,0,16,16]},"down":{"texture":"axis","uv":[0,0,16,16]},"east":{"texture":"axis","uv":[0,0,16,16]},"west":{"texture":"axis","uv":[0,0,16,16]}}}]},"press":{"elements":[{"from":[0,14,0],"to":[16,16,16],"faces":{"north":{"texture":"gearbox","uv":[0,0,16,2]},"east":{"texture":"mechanical_press_side","uv":[0,0,16,2]},"south":{"texture":"gearbox","uv":[0,0,16,2]},"west":{"texture":"mechanical_press_side","uv":[0,0,16,2]},"up":{"texture":"mechanical_press_top","uv":[0,0,16,16]},"down":{"texture":"gearbox","uv":[0,0,16,16]}}},{"from":[2,4,0.95],"to":[14,14,15.05],"faces":{"north":{"texture":"gearbox","uv":[2,2,14,12]},"south":{"texture":"gearbox","uv":[2,2,14,12]},"down":{"texture":"mechanical_press_bottom","uv":[2,1,14,15]}}},{"from":[0,2,0],"to":[2,14,16],"faces":{"north":{"texture":"gearbox_top","uv":[14,2,16,14]},"east":{"texture":"mechanical_press_side","uv":[0,2,16,14]},"south":{"texture":"gearbox_top","uv":[0,2,2,14]},"west":{"texture":"mechanical_press_side","uv":[0,2,16,14]},"down":{"texture":"gearbox_top","uv":[0,0,2,16]}}},{"from":[14,2,0],"to":[16,14,16],"faces":{"north":{"texture":"gearbox_top","uv":[0,2,2,14]},"east":{"texture":"mechanical_press_side","uv":[0,2,16,14]},"south":{"texture":"gearbox_top","uv":[14,2,16,14]},"west":{"texture":"mechanical_press_side","uv":[0,2,16,14]},"down":{"texture":"gearbox_top","uv":[14,0,16,16]}}},{"from":[6,3,6],"to":[10,13,10],"faces":{"north":{"texture":"mechanical_press_pole"},"south":{"texture":"mechanical_press_pole"},"east":{"texture":"mechanical_press_pole"},"west":{"texture":"mechanical_press_pole"}}},{"from":[3,13,3],"to":[13,16,13],"faces":{"north":{"texture":"mechanical_press_head"},"south":{"texture":"mechanical_press_head"},"east":{"texture":"mechanical_press_head"},"west":{"texture":"mechanical_press_head"},"up":{"texture":"mechanical_press_head"},"down":{"texture":"mechanical_press_head"}}}]},"millstone":{"elements":[{"from":[0,0,0],"to":[16,6,2],"faces":{"north":{"texture":"millstone","uv":[0,13,8,16]},"east":{"texture":"millstone","uv":[7,13,8,16]},"south":{"texture":"millstone","uv":[0,13,8,16]},"west":{"texture":"millstone","uv":[0,13,1,16]},"up":{"texture":"millstone","uv":[0,13,8,14]},"down":{"texture":"gearbox","uv":[0,14,16,16]}}},{"from":[0,0,14],"to":[16,6,16],"faces":{"north":{"texture":"millstone","uv":[8,13,0,16]},"east":{"texture":"millstone","uv":[8,13,7,16]},"south":{"texture":"millstone","uv":[8,13,0,16]},"west":{"texture":"millstone","uv":[1,13,0,16]},"up":{"texture":"millstone","uv":[0,13,8,14],"rotation":180},"down":{"texture":"gearbox","uv":[0,16,16,14]}}},{"from":[0,0,2],"to":[2,6,14],"faces":{"east":{"texture":"millstone","uv":[1,13,7,16]},"west":{"texture":"millstone","uv":[1,13,7,16]},"up":{"texture":"millstone","uv":[1,13,7,14],"rotation":270},"down":{"texture":"gearbox","uv":[0,2,2,14]}}},{"from":[14,0,2],"to":[16,6,14],"faces":{"east":{"texture":"millstone","uv":[7,13,1,16]},"west":{"texture":"millstone","uv":[7,13,1,16]},"up":{"texture":"millstone","uv":[1,13,7,14],"rotation":90},"down":{"texture":"gearbox","uv":[2,2,0,14]}}},{"from":[2,1,2],"to":[14,6,14],"faces":{"up":{"texture":"millstone","uv":[0,0,6,6],"rotation":270},"down":{"texture":"gearbox","uv":[2,2,14,14]}}},{"from":[2,12,2],"to":[14,16,14],"faces":{"north":{"texture":"millstone","uv":[10,8,16,10]},"east":{"texture":"millstone","uv":[10,8,16,10]},"south":{"texture":"millstone","uv":[10,8,16,10]},"west":{"texture":"millstone","uv":[10,8,16,10]},"up":{"texture":"millstone","uv":[16,2,10,8]},"down":{"texture":"millstone","uv":[16,2,10,8]}}},{"from":[4,12,4],"to":[12,15,12],"faces":{"north":{"texture":"millstone"},"south":{"texture":"millstone"},"east":{"texture":"millstone"},"west":{"texture":"millstone"},"up":{"texture":"millstone"},"down":{"texture":"millstone"}}}]},"saw":{"elements":[{"from":[0,0,0],"to":[16,2,12],"faces":{"north":{"texture":"andesite_casing_short","uv":[0,14,16,16]},"east":{"texture":"andesite_casing_short","uv":[4,14,16,16]},"south":{"texture":"encased_chain_drive","uv":[0,14,16,16]},"west":{"texture":"andesite_casing_short","uv":[0,14,12,16]},"up":{"texture":"andesite_casing_short","uv":[0,4,16,16]},"down":{"texture":"andesite_casing_short","uv":[0,4,16,16]}}},{"from":[0,14,0],"to":[16,16,12],"faces":{"north":{"texture":"andesite_casing_short","uv":[0,4,16,6]},"east":{"texture":"andesite_casing_short","uv":[4,4,16,6]},"south":{"texture":"encased_chain_drive","uv":[0,0,16,2]},"west":{"texture":"andesite_casing_short","uv":[0,4,12,6]},"up":{"texture":"andesite_casing_short","uv":[0,4,16,16]},"down":{"texture":"andesite_casing_short","uv":[0,4,16,16]}}},{"from":[0,2,0],"to":[2,14,2],"faces":{"north":{"texture":"gearbox_top","uv":[14,2,16,14]},"east":{"texture":"gearbox_top","uv":[14,2,16,14]},"south":{"texture":"gearbox_top","uv":[0,2,2,14]},"west":{"texture":"gearbox_top","uv":[0,2,2,14]}}},{"from":[0,2,2],"to":[16,14,11.025],"faces":{"east":{"texture":"andesite_casing_short","uv":[2,6,14,15],"rotation":90},"south":{"texture":"mechanical_saw_top_no_slot","uv":[0,2,16,14]},"west":{"texture":"andesite_casing_short","uv":[2,6,14,15],"rotation":270}}},{"from":[14,2,0],"to":[16,14,2],"faces":{"north":{"texture":"gearbox_top","uv":[0,2,2,14]},"east":{"texture":"gearbox_top","uv":[14,2,16,14]},"south":{"texture":"gearbox_top","uv":[0,2,2,14]},"west":{"texture":"gearbox_top","uv":[0,2,2,14]}}},{"from":[2,2,0.95],"to":[14,14,1.95],"faces":{"north":{"texture":"gearbox","uv":[2,2,14,14]}}},{"from":[2,8,7],"to":[14,10,9],"faces":{"north":{"texture":"static_saw"},"south":{"texture":"static_saw"},"east":{"texture":"static_saw"},"west":{"texture":"static_saw"},"up":{"texture":"static_saw"},"down":{"texture":"static_saw"}}}]},"mixer":{"elements":[{"from":[0,10,0],"to":[16,16,16],"faces":{"north":{"texture":"mixer_base_side","uv":[0,0,16,6]},"east":{"texture":"mixer_base_side","uv":[0,0,16,6]},"south":{"texture":"mixer_base_side","uv":[0,0,16,6]},"west":{"texture":"mixer_base_side","uv":[0,0,16,6]},"up":{"texture":"mechanical_press_top","uv":[0,0,16,16]},"down":{"texture":"andesite_casing","uv":[0,0,16,16]}}},{"from":[0,2,0],"to":[16,6,16],"faces":{"north":{"texture":"mixer_base_side","uv":[0,10,16,14]},"east":{"texture":"mixer_base_side","uv":[0,10,16,14]},"south":{"texture":"mixer_base_side","uv":[0,10,16,14]},"west":{"texture":"mixer_base_side","uv":[0,10,16,14]},"up":{"texture":"andesite_casing","uv":[0,0,16,16]},"down":{"texture":"mechanical_press_top","uv":[0,0,16,16]}}},{"from":[0,6,0],"to":[0.1,10,16],"faces":{"east":{"texture":"mixer_base_side","uv":[0,6,16,10]},"west":{"texture":"mixer_base_side","uv":[0,6,16,10]}}},{"from":[15.9,6,0],"to":[16,10,16],"faces":{"east":{"texture":"mixer_base_side","uv":[0,6,16,10]},"west":{"texture":"mixer_base_side","uv":[0,6,16,10]}}},{"from":[0,6,15.9],"to":[16,10,16],"faces":{"north":{"texture":"mixer_base_side","uv":[0,6,16,10]},"south":{"texture":"mixer_base_side","uv":[0,6,16,10]}}},{"from":[0,6,0],"to":[16,10,0.1],"faces":{"north":{"texture":"mixer_base_side","uv":[0,6,16,10]},"south":{"texture":"mixer_base_side","uv":[0,6,16,10]}}},{"from":[7,3,7],"to":[9,13,9],"faces":{"north":{"texture":"mechanical_press_pole"},"south":{"texture":"mechanical_press_pole"},"east":{"texture":"mechanical_press_pole"},"west":{"texture":"mechanical_press_pole"}}},{"from":[6,15,6],"to":[10,16,10],"faces":{"up":{"texture":"axis"}}},{"from":[5,2,5],"to":[11,4,11],"faces":{"north":{"texture":"mixer_head"},"south":{"texture":"mixer_head"},"east":{"texture":"mixer_head"},"west":{"texture":"mixer_head"},"up":{"texture":"mixer_head"},"down":{"texture":"mixer_head"}}}]},"hand_crank":{"elements":[{"from":[4,0,4],"to":[12,3,12],"faces":{"north":{"texture":"andesite_casing_short"},"south":{"texture":"andesite_casing_short"},"east":{"texture":"andesite_casing_short"},"west":{"texture":"andesite_casing_short"},"up":{"texture":"andesite_casing_short"},"down":{"texture":"andesite_casing_short"}}},{"from":[7,3,7],"to":[9,9,9],"faces":{"north":{"texture":"axis"},"south":{"texture":"axis"},"east":{"texture":"axis"},"west":{"texture":"axis"},"up":{"texture":"axis"},"down":{"texture":"axis"}}},{"from":[3,8,7],"to":[8,10,9],"faces":{"north":{"texture":"smooth_dark_log_top"},"south":{"texture":"smooth_dark_log_top"},"east":{"texture":"smooth_dark_log_top"},"west":{"texture":"smooth_dark_log_top"},"up":{"texture":"smooth_dark_log_top"},"down":{"texture":"smooth_dark_log_top"}}},{"from":[2,7,6],"to":[4,11,10],"faces":{"north":{"texture":"andesite_casing_short"},"south":{"texture":"andesite_casing_short"},"east":{"texture":"andesite_casing_short"},"west":{"texture":"andesite_casing_short"},"up":{"texture":"andesite_casing_short"},"down":{"texture":"andesite_casing_short"}}}]},"motor":{"elements":[{"from":[3,3,0.1],"to":[13,13,2.1],"faces":{"north":{"texture":"creative_motor","uv":[0,0,10,10]},"east":{"texture":"creative_casing","uv":[3,0,13,2],"rotation":90},"south":{"texture":"creative_motor","uv":[0,0,10,10]},"west":{"texture":"creative_casing","uv":[3,0,13,2],"rotation":270},"up":{"texture":"creative_casing","uv":[3,0,13,2]},"down":{"texture":"creative_casing","uv":[3,0,13,2],"rotation":180}}},{"from":[3,3,12],"to":[13,13,14],"faces":{"north":{"texture":"creative_motor","uv":[10,0,0,10]},"east":{"texture":"creative_casing","uv":[3,2,13,0],"rotation":90},"south":{"texture":"creative_motor","uv":[10,0,0,10]},"west":{"texture":"creative_casing","uv":[3,2,13,0],"rotation":270},"up":{"texture":"creative_casing","uv":[3,2,13,0]},"down":{"texture":"creative_casing","uv":[3,2,13,0],"rotation":180}}},{"from":[5,5,9],"to":[11,11,13],"faces":{"north":{"texture":"creative_motor","uv":[14,4,20,10]},"east":{"texture":"creative_motor","uv":[10,6,16,10],"rotation":90},"south":{"texture":"creative_motor","uv":[10,0,16,6]},"west":{"texture":"creative_motor","uv":[10,6,16,10],"rotation":270},"up":{"texture":"creative_motor","uv":[10,6,16,10]},"down":{"texture":"creative_motor","uv":[10,6,16,10],"rotation":180}}},{"from":[3.5,3.5,2],"to":[12.5,12.5,5],"faces":{"east":{"texture":"creative_motor","uv":[3.5,10,12.5,13],"rotation":270},"west":{"texture":"creative_motor","uv":[3.5,10,12.5,13],"rotation":90},"up":{"texture":"creative_motor","uv":[3.5,10,12.5,13],"rotation":180},"down":{"texture":"creative_motor","uv":[3.5,10,12.5,13]}}},{"from":[4,4,2],"to":[12,12,11],"faces":{"north":{"texture":"creative_casing","uv":[0,4,8,14],"rotation":180},"east":{"texture":"creative_casing","uv":[4,3,12,12],"rotation":90},"south":{"texture":"creative_casing","uv":[3,3,11,11],"rotation":180},"west":{"texture":"creative_casing","uv":[4,3,12,12],"rotation":90},"up":{"texture":"creative_casing","uv":[4,3,12,12],"rotation":180},"down":{"texture":"creative_casing","uv":[4,3,12,12],"rotation":180}}},{"from":[12,12,0],"to":[14,14,15],"faces":{"north":{"texture":"creative_motor","uv":[16,10,14,12]},"east":{"texture":"axis","uv":[6,15,8,0],"rotation":270},"south":{"texture":"creative_motor","uv":[14,12,16,10],"rotation":90},"west":{"texture":"axis","uv":[8,16,10,1],"rotation":90},"up":{"texture":"axis","uv":[9,0,7,15]},"down":{"texture":"axis","uv":[8,1,6,16]}}},{"from":[2,12,0],"to":[4,14,15],"faces":{"north":{"texture":"creative_motor","uv":[16,10,14,12]},"east":{"texture":"axis","uv":[6,15,8,0],"rotation":270},"south":{"texture":"creative_motor","uv":[14,12,16,10],"rotation":90},"west":{"texture":"axis","uv":[8,16,10,1],"rotation":90},"up":{"texture":"axis","uv":[9,0,7,15]},"down":{"texture":"axis","uv":[8,1,6,16]}}},{"from":[2,2,0],"to":[4,4,15],"faces":{"north":{"texture":"creative_motor","uv":[16,10,14,12]},"east":{"texture":"axis","uv":[6,15,8,0],"rotation":270},"south":{"texture":"creative_motor","uv":[14,12,16,10],"rotation":90},"west":{"texture":"axis","uv":[8,16,10,1],"rotation":90},"up":{"texture":"axis","uv":[9,0,7,15]},"down":{"texture":"axis","uv":[8,1,6,16]}}},{"from":[12,2,0],"to":[14,4,15],"faces":{"north":{"texture":"creative_motor","uv":[16,10,14,12]},"east":{"texture":"axis","uv":[6,15,8,0],"rotation":270},"south":{"texture":"creative_motor","uv":[14,12,16,10],"rotation":90},"west":{"texture":"axis","uv":[8,16,10,1],"rotation":90},"up":{"texture":"axis","uv":[9,0,7,15]},"down":{"texture":"axis","uv":[8,1,6,16]}}},{"from":[1,0,3],"to":[15,3,10],"faces":{"north":{"texture":"flap_display_front","uv":[0,0,14,3]},"east":{"texture":"flap_display_front","uv":[8,0,15,3]},"south":{"texture":"flap_display_front","uv":[1,0,15,3]},"west":{"texture":"flap_display_front","uv":[8,0,15,3]},"up":{"texture":"flap_display_front","uv":[1,2,8,16],"rotation":90},"down":{"texture":"flap_display_front","uv":[1,4,15,11]}}},{"from":[5,7,4],"to":[11,13,10],"faces":{"north":{"texture":"creative_motor","uv":[10,0,16,6]},"east":{"texture":"creative_motor","uv":[10,0,16,6]},"south":{"texture":"creative_motor","uv":[10,0,16,6]},"west":{"texture":"creative_motor","uv":[10,0,16,6]},"up":{"texture":"creative_motor","uv":[10,0,16,6]},"down":{"texture":"creative_motor","uv":[10,0,16,6]}}},{"from":[3,5,4],"to":[13,11,10],"faces":{"north":{"texture":"creative_motor","uv":[10,0,16,6]},"east":{"texture":"creative_motor","uv":[10,0,16,6]},"south":{"texture":"creative_motor","uv":[10,0,16,6]},"west":{"texture":"creative_motor","uv":[10,0,16,6]},"up":{"texture":"creative_motor","uv":[10,0,16,6]},"down":{"texture":"creative_motor","uv":[10,0,16,6]}}}]},"sail":{"elements":[{"from":[0,5,13],"to":[3,9,16],"faces":{"north":{"texture":"sail_frame","uv":[5,9,8,13]},"east":{"texture":"sail_frame","uv":[2,9,5,13]},"south":{"texture":"sail_frame","uv":[8,9,11,13]},"west":{"texture":"sail_frame","uv":[11,9,14,13]},"down":{"texture":"sail_frame","uv":[13,13,16,16],"rotation":180}},"rotation":{"origin":[8,14,8],"axis":"y","angle":0,"rescale":false}},{"from":[0,5,0],"to":[3,9,3],"faces":{"north":{"texture":"sail_frame","uv":[11,9,14,13]},"east":{"texture":"sail_frame","uv":[5,9,8,13]},"south":{"texture":"sail_frame","uv":[2,9,5,13]},"west":{"texture":"sail_frame","uv":[8,9,11,13]},"down":{"texture":"sail_frame","uv":[13,0,16,3],"rotation":180}},"rotation":{"origin":[8,14,-5],"axis":"y","angle":0,"rescale":false}},{"from":[13,5,13],"to":[16,9,16],"faces":{"north":{"texture":"sail_frame","uv":[2,9,5,13]},"east":{"texture":"sail_frame","uv":[8,9,11,13]},"south":{"texture":"sail_frame","uv":[11,9,14,13]},"west":{"texture":"sail_frame","uv":[5,9,8,13]},"down":{"texture":"sail_frame","uv":[0,13,3,16],"rotation":180}},"rotation":{"origin":[21,14,8],"axis":"y","angle":0,"rescale":false}},{"from":[13,5,0],"to":[16,9,3],"faces":{"north":{"texture":"sail_frame","uv":[8,9,11,13]},"east":{"texture":"sail_frame","uv":[11,9,14,13]},"south":{"texture":"sail_frame","uv":[5,9,8,13]},"west":{"texture":"sail_frame","uv":[2,9,5,13]},"down":{"texture":"sail_frame","uv":[0,0,3,3],"rotation":180}},"rotation":{"origin":[21,14,-5],"axis":"y","angle":0,"rescale":false}},{"from":[3,6,14],"to":[13,9,16],"faces":{"north":{"texture":"sail_frame","uv":[3,6,13,9]},"south":{"texture":"sail_frame","uv":[3,3,13,6]},"down":{"texture":"sail_frame","uv":[3,14,13,16],"rotation":180}},"rotation":{"origin":[11,15,8],"axis":"y","angle":0,"rescale":false}},{"from":[0,6,3],"to":[2,9,13],"faces":{"east":{"texture":"sail_frame","uv":[3,6,13,9]},"west":{"texture":"sail_frame","uv":[3,3,13,6]},"down":{"texture":"sail_frame","uv":[14,3,16,13],"rotation":180}}},{"from":[3,6,0],"to":[13,9,2],"faces":{"north":{"texture":"sail_frame","uv":[3,3,13,6]},"south":{"texture":"sail_frame","uv":[3,6,13,9]},"down":{"texture":"sail_frame","uv":[3,0,13,2],"rotation":180}}},{"from":[14,6,3],"to":[16,9,13],"faces":{"east":{"texture":"sail_frame","uv":[3,3,13,6]},"west":{"texture":"sail_frame","uv":[3,6,13,9]},"down":{"texture":"sail_frame","uv":[0,3,2,13],"rotation":180}}},{"from":[0,9,0],"to":[16,10,16],"faces":{"north":{"texture":"sail_canvas_white","uv":[0,0,16,1],"rotation":180},"east":{"texture":"sail_canvas_white","uv":[15,0,16,16],"rotation":90},"south":{"texture":"sail_canvas_white","uv":[0,15,16,16]},"west":{"texture":"sail_canvas_white","uv":[0,0,1,16],"rotation":270},"up":{"texture":"sail_canvas_white","uv":[16,16,0,0]},"down":{"texture":"sail_canvas_white","uv":[0,0,16,16],"rotation":180}}}]}};
// ==== MODELS END ====

OpusMC.data('create', {
  tab: { name: '机械动力', icon: 'create_andesite_casing' },

  blocks: {
    // ---- 机壳 ----
    create_andesite_casing: {
      name: '安山岩机壳',
      texture: 'andesite_casing',
      hardness: 1.5,
      tool: 'pickaxe',
      level: 1,
      sound: 'stone'
    },

    // ---- 传动件（原版模型）----
    create_shaft: {
      name: '传动轴',
      shape: 'model',
      model: CREATE_MODELS.shaft,
      hardness: 0.8,
      tool: 'axe',
      sound: 'wood'
    },

    create_cogwheel: {
      name: '齿轮',
      shape: 'model',
      model: CREATE_MODELS.cogwheel,
      hardness: 0.8,
      tool: 'axe',
      sound: 'wood'
    },

    create_large_cogwheel: {
      name: '大齿轮',
      shape: 'model',
      model: CREATE_MODELS.large_cogwheel,
      hardness: 0.8,
      tool: 'axe',
      sound: 'wood'
    },

    // ---- 动力源 ----
    create_water_wheel: {
      name: '水车',
      shape: 'model',
      model: CREATE_MODELS.water_wheel,
      hardness: 1,
      tool: 'axe',
      sound: 'wood'
    },

    create_windmill_bearing: {
      name: '风车轴承',
      textures: { side: 'windmill_bearing', top: 'bearing_top', bottom: 'andesite_casing' },
      hardness: 1.5,
      tool: 'axe',
      sound: 'wood'
    },

    create_hand_crank: {
      name: '手摇曲柄',
      shape: 'model',
      model: CREATE_MODELS.hand_crank,
      hardness: 1,
      tool: 'axe',
      sound: 'wood'
    },

    create_creative_motor: {
      name: '创造马达',
      shape: 'model',
      model: CREATE_MODELS.motor,
      hardness: 2,
      tool: 'pickaxe',
      level: 1,
      light: 7,
      sound: 'metal'
    },

    // ---- 机械（原版模型）----
    create_mechanical_press: {
      name: '机械压机',
      shape: 'model',
      model: CREATE_MODELS.press,
      hardness: 2,
      tool: 'pickaxe',
      level: 1,
      sound: 'stone'
    },

    create_millstone: {
      name: '石磨',
      shape: 'model',
      model: CREATE_MODELS.millstone,
      hardness: 2,
      tool: 'pickaxe',
      level: 1,
      sound: 'stone'
    },

    create_mechanical_saw: {
      name: '动力锯',
      shape: 'model',
      model: CREATE_MODELS.saw,
      hardness: 2,
      tool: 'axe',
      sound: 'metal'
    },

    create_mechanical_mixer: {
      name: '机械搅拌器',
      shape: 'model',
      model: CREATE_MODELS.mixer,
      hardness: 2,
      tool: 'axe',
      sound: 'stone'
    },

    // ---- 矿物 ----
    create_zinc_ore: {
      name: '锌矿石',
      texture: 'zinc_ore',
      hardness: 3,
      tool: 'pickaxe',
      level: 1,
      sound: 'stone',
      xp: [0, 1],
      drops: { item: 'create_raw_zinc', min: 1, max: 2 }
    },

    // ---- 机壳（后加，编号接在锌矿后面，老存档的编号不动）----
    create_brass_casing: {
      name: '黄铜机壳',
      texture: 'brass_casing',
      hardness: 1.5,
      tool: 'pickaxe',
      level: 1,
      sound: 'stone'
    },

    create_copper_casing: {
      name: '铜机壳',
      texture: 'copper_casing',
      hardness: 1.5,
      tool: 'pickaxe',
      level: 1,
      sound: 'stone'
    },

    // 风帆：风车轴承要接到帆上才转（原版是 bearing + 一排 sail）
    create_white_sail: {
      name: '白色风帆',
      shape: 'model',
      model: CREATE_MODELS.sail,
      hardness: 0.5,
      sound: 'cloth',
      solid: false,
      transparent: true
    }
  },

  items: {
    create_andesite_alloy: { name: '安山岩合金', texture: 'andesite_alloy' },
    create_iron_sheet: { name: '铁板', texture: 'iron_sheet' },
    create_copper_sheet: { name: '铜板', texture: 'copper_sheet' },
    create_golden_sheet: { name: '金板', texture: 'golden_sheet' },
    create_brass_ingot: { name: '黄铜锭', texture: 'brass_ingot' },
    create_brass_sheet: { name: '黄铜板', texture: 'brass_sheet' },
    create_zinc_ingot: { name: '锌锭', texture: 'zinc_ingot' },
    create_raw_zinc: { name: '粗锌', texture: 'raw_zinc' },
    create_wheat_flour: { name: '面粉', texture: 'wheat_flour' },
    // 护目镜：头盔栏护甲（slot head），戴上后看向传动件显示转速 / 应力
    create_goggles: {
      name: '工程师护目镜',
      texture: 'goggles',
      stack: 1,
      armor: { slot: 'head', points: 0, toughness: 0 }
    },
    create_brass_nugget: { name: '黄铜粒', texture: 'brass_nugget' },
    create_zinc_nugget: { name: '锌粒', texture: 'zinc_nugget' },
    create_precision_mechanism: { name: '精密构件', texture: 'precision_mechanism' },
    create_sturdy_sheet: { name: '坚固板', texture: 'sturdy_sheet' }
  },

  recipes: [
    // ---- Create 原配方 ----
    // 传动轴：2 安山岩合金竖排 → 8
    { type: 'shaped', pattern: ['A', 'A'], key: { A: 'create_andesite_alloy' }, result: 'create_shaft', count: 8 },
    // 齿轮：传动轴 + 木板（无序）
    { type: 'shapeless', ingredients: ['create_shaft', 'minecraft:oak_planks'], result: 'create_cogwheel' },
    // 大齿轮：传动轴 + 2 木板
    { type: 'shapeless', ingredients: ['create_shaft', 'minecraft:oak_planks', 'minecraft:oak_planks'], result: 'create_large_cogwheel' },
    // 水车：3×3 木板围传动轴
    { type: 'shaped', pattern: ['SSS', 'SCS', 'SSS'], key: { S: 'minecraft:oak_planks', C: 'create_shaft' }, result: 'create_water_wheel' },
    // 风车轴承：台阶 / 石头 / 传动轴
    { type: 'shaped', pattern: ['B', 'C', 'I'], key: { B: 'minecraft:oak_slab', C: 'minecraft:stone', I: 'create_shaft' }, result: 'create_windmill_bearing' },
    // 机械压机：传动轴 / 机壳 / 铁块
    { type: 'shaped', pattern: ['S', 'C', 'I'], key: { S: 'create_shaft', C: 'create_andesite_casing', I: 'minecraft:iron_block' }, result: 'create_mechanical_press' },
    // 石磨：齿轮 / 机壳 / 石头
    { type: 'shaped', pattern: ['C', 'S', 'I'], key: { C: 'create_cogwheel', S: 'create_andesite_casing', I: 'minecraft:stone' }, result: 'create_millstone' },
    // 动力锯：" A " / "AIA" / " C "
    { type: 'shaped', pattern: [' A ', 'AIA', ' C '], key: { A: 'create_iron_sheet', I: 'minecraft:iron_ingot', C: 'create_andesite_casing' }, result: 'create_mechanical_saw' },
    // 机械搅拌器：齿轮 / 机壳 / 铁板
    { type: 'shaped', pattern: ['S', 'C', 'I'], key: { S: 'create_cogwheel', C: 'create_andesite_casing', I: 'create_iron_sheet' }, result: 'create_mechanical_mixer' },
    // 手摇曲柄：3 木板 + 安山岩合金
    { type: 'shaped', pattern: ['CCC', '  A'], key: { C: 'minecraft:oak_planks', A: 'create_andesite_alloy' }, result: 'create_hand_crank' },
    // 安山岩机壳：安山岩合金 + 原木 → 2
    { type: 'shaped', pattern: ['A', 'L'], key: { A: 'create_andesite_alloy', L: 'minecraft:oak_log' }, result: 'create_andesite_casing', count: 2 },

    // ---- 材料链 ----
    // 安山岩合金：安山岩 + 铁粒（原版是搅拌盆混合，这里给手工配方防止死锁）
    { type: 'shapeless', ingredients: ['minecraft:andesite', 'minecraft:iron_nugget'], result: 'create_andesite_alloy' },
    // 黄铜锭：铜锭 + 锌锭（原版是加热搅拌，产能 2 锭；见 code.js 的搅拌器）
    { type: 'shapeless', ingredients: ['minecraft:copper_ingot', 'create_zinc_ingot'], result: 'create_brass_ingot', count: 2 },
    // 粒 ↔ 锭
    { type: 'shapeless', ingredients: ['create_brass_ingot'], result: 'create_brass_nugget', count: 9 },
    { type: 'shapeless', ingredients: ['create_zinc_ingot'], result: 'create_zinc_nugget', count: 9 },
    // 精密构件：黄铜板 + 铁板 + 齿轮
    { type: 'shapeless', ingredients: ['create_brass_sheet', 'create_iron_sheet', 'create_cogwheel'], result: 'create_precision_mechanism' },
    // 机壳：板 + 安山岩合金
    { type: 'shapeless', ingredients: ['create_brass_sheet', 'create_andesite_alloy'], result: 'create_brass_casing', count: 2 },
    { type: 'shapeless', ingredients: ['create_copper_sheet', 'create_andesite_alloy'], result: 'create_copper_casing', count: 2 },
    // 护目镜：2 金板 + 2 玻璃板
    { type: 'shapeless', ingredients: ['create_golden_sheet', 'create_golden_sheet', 'minecraft:glass_pane', 'minecraft:glass_pane'], result: 'create_goggles' },
    { type: 'shapeless', ingredients: ['minecraft:white_wool', 'minecraft:white_wool', 'minecraft:stick'], result: 'create_white_sail', count: 2 },
    // 坚固板：安山岩合金压铁板（原版靠粉碎黑曜石，这里简化）
    { type: 'shapeless', ingredients: ['create_iron_sheet', 'create_andesite_alloy'], result: 'create_sturdy_sheet' },
    // 锌锭：烧粗锌
    { type: 'smelting', input: 'create_raw_zinc', result: 'create_zinc_ingot', xp: 0.7 }
  ],

  ores: [
    { block: 'create_zinc_ore', size: 9, perChunk: 8, minY: -16, maxY: 64, distribution: 'triangle' }
  ]
});
