// Names from the Yoshi's Story source leak (J cast and world tables matched entry by entry; see
// docs/YOSHISTORY.md §4.1 and §5.7): cast id (hex) -> actor name, and world table index -> world name.

const CAST_NAME_TEXT = `
4001:yoshi 4002:tamago 4003:aim 4004:st_tamago 4005:st_tamago 4006:dummyYoshi 4007:shadow 4008:coinget1
4009:smoke 400a:effstar 400b:bero 400c:bero_top 400d:page 400e:f_efect 400f:coingetR 4010:nikoFace
4011:nikoPetal 4012:smokeTest 4013:getMeter 4014:fide 4015:kokamekku 4016:fukidashi 4017:fukisuuji
4018:fireworks 4019:rakkasan 401a:rakkasanpara 401b:superKira 401c:black_tamago 401d:black_tamago 401e:tamago
401f:extraHeiho 4020:pause 4021:message4 4022:message5 4023:message6 4024:message 4025:pausefide 4026:ase
4027:pika 4028:luckey_apple 4029:luckey_banana 402a:luckey_watermelon 402b:luckey_budou 402c:pauseFruit
402d:likeFruit 4030:apple 4031:banana 4032:watermelon 4033:kinomi1 4034:kinomi2 4035:drug 4037:parasol
4038:ahodori 4039:leafRide 403a:heiho 403b:muteki 403c:muteki 403d:muteki 403e:obake2 403f:obake2 4040:fheiho
4041:hopping_ctr 4042:hopping 4043:heiho 4044:heiho 4045:heiho 4046:fbomhei 4047:heiho_f_group
4048:heiho_f_group 404a:oval 404b:popoval 404c:hone0 404d:hone1 404e:hone2 404f:hone3 4050:hone4 4051:hone5
4052:hone6 4053:hone7 4054:teresa 4055:trsblk 4056:teresa 4057:obake2 4058:dpwater 4059:suiteki
405a:suitekibody 405b:lampred 405c:lampblue 405d:lampgreen 405e:lampmaguma 405f:lampchild 4066:packn2
4067:packn2h 4068:packn2kuki 406b:karugamo 406c:kokarugamo 406e:unrestlift 406f:coin 4070:coin1 4071:tenCoin
4072:majin 4074:star 4075:wanwan 4079:heiho_f_group 407a:goroshad 407b:gorogoro2 407c:heiho_f_group
407d:seesaw 407e:seesaw_lg 407f:seesaw_sm 4080:pole 4081:pole 4082:junction 4083:junction 4084:juncSwitch
4085:Qblock2 4086:eggblock 4087:Msgblock 4088:msgback 4089:moocho 408a:moocho2 408b:moocho3 408c:moocho4
408d:moocho5 408e:moocho6 408f:moocho7 4090:waterfall 4091:test_bee5 4092:heiho_f_group 4093:snow2 4094:snow3
4095:snow4 4096:rain4 4097:rain3 4099:twinkle 409a:seesaw2 409c:katikati_foot 409d:katikati_head 409e:penguin
409f:bakudan 40a0:houdan 40a1:fly_bakudan 40a2:danballFence 40a3:donbaba 40a4:donbaba_body 40a5:donbaba_eye
40a6:donbaba_foot 40a7:donbaba_lip 40a8:poly 40a9:stalk 40aa:stalk 40ab:stalk 40ac:stalk 40ad:stalk
40ae:polybox 40af:jugei 40b0:jugei 40b1:cloud 40b2:jsibu 40b3:jtaki 40b4:paipo 40b5:kemuhead 40b6:kemubody
40b7:select 40b8:hookBlock 40b9:nintendo 40bc:rugget 40be:drum 40bf:drum2 40c0:drum3 40c1:bolt 40c2:comb
40c3:saku 40c5:flower 40c6:buku 40c7:newbreath 40c8:gradation 40c9:gr01 40ca:gr02 40cb:gr03 40cc:gr04
40cd:gr05 40ce:gr06 40cf:gr07 40d0:gr08 40d1:gr09 40d2:gr10 40d3:gr11 40d4:gr12 40d5:gr13 40d7:railLift
40d8:railLift 40d9:railLift 40da:railLift 40db:railLift 40dc:railLift 40dd:railLift 40de:railLift
40df:railLift 40e0:railLift 40e1:railLift 40e2:railLift 40e3:fukikumo_v 40e4:fukikumo_h 40e5:fukikumo_h
40e6:fukikumo_v 40e7:fukikumo_h 40e8:fukikumo_h 40e9:eff_kaze 40ea:awaawa 40eb:panorama2 40ec:f_efect
40ed:handcos 40ee:handcos 40ef:pushstart 40f0:mdemomsg 40f1:message2 40f2:message3 40f3:mdemomsg
40f4:mdemomsg 40f5:mpagetitle 40f6:manacos 40f7:mdemomsg 40f8:mdemomsg 40f9:stopper 4103:surface 4104:bigwave
4105:bigwave 4106:monsterwave 4107:pakkun 4108:b2p0 4109:b2p1 410a:b2p0 410b:b2p1 410c:fill 410d:heiho
410e:pendulum 410f:pendulum 4110:pendulum 4111:fixseesaw 4112:cask 4113:cask_morph 4115:luggage 4116:lookat
4118:octagon 4119:octstool 411a:octmetal 411b:octhilite 411c:escaPro 411d:escaProR 411e:esca0 411f:togePro
4120:toge0 4121:kusariPro 4122:kusari0 4123:qChan1 4124:qPlanet0 4125:qPlanet1 4126:qPlaShad 4127:lfslime
4128:lfshead 4129:dragon 412a:drhead 412b:drneck 412c:fball 412d:fspark 412e:dr01 412f:dr02 4130:dr03
4131:brge 4132:brge16 4133:brge24 4134:brge32 4135:rope 4136:rope16 4137:rope24 4138:rope32 4139:ropeedge
413a:lava1 413b:lavaeff 413c:lavatail 413d:sfdokan 413e:heihoship_boss 413f:heihoship_body
4140:heihoship_frag 4141:heihoship_sail 4142:heihoship_mihari 4144:bombSoldier 4146:timeAttackFG
4147:timeAttack_Start 414a:timeAttack_Goal 414b:timeAttack_Haba 414c:unabon 414d:unabonbody 414e:unabontail
414f:mdonguri 4150:rmv_llift 4151:lmv_llift 4152:umv_llift 4153:dmv_llift 4154:down_llift 4155:udw_llift
4156:rdw_llift 4157:ldw_llift 4158:stop_llift 4159:tup_llift 415a:tdw_llift 415b:niko_llift 415c:rmv_mlift
415d:lmv_mlift 415e:umv_mlift 415f:dmv_mlift 4160:down_mlift 4161:udw_mlift 4162:rdw_mlift 4163:ldw_mlift
4164:stop_mlift 4165:tup_mlift 4166:tdw_mlift 4167:niko_mlift 4168:rmv_slift 4169:lmv_slift 416a:umv_slift
416b:dmv_slift 416c:down_slift 416d:udw_slift 416e:rdw_slift 416f:ldw_slift 4170:stop_slift 4171:tup_slift
4172:tdw_slift 4173:niko_slift 4174:uin_lbox 4175:uin_mbox 4176:uin_sbox 4177:din_lbox 4178:din_mbox
4179:din_sbox 417a:dout_box 417b:uout_box 417c:Ucastlelift 417d:Dcastlelift 417e:dashheiho_upr
417f:dashheiho_upl 4180:dashheiho_dwr 4181:dashheiho_dwl 4182:puroperah_All 4183:puroperah_All
4184:puroperah_All 4185:puroperah_All 4186:puroperah_All 4187:puroperah_All 4188:puroperah_All
4189:puroperah_All 418a:puroperah_All 418b:puroperah_All 418c:puroperah_All 418d:puroperah_All 418e:jellyfish
418f:jellyfish 4190:jellyfish 4191:jellyfish 4192:jellyfish 4193:jellyfish 4194:heiho_g 4195:minipuku_g
4198:atamaheiho 4199:atamaheiho 419a:atamaheiho 419b:atamaheiho 419c:atamaheiho 419d:atamaheiho 419f:sfroof
41a1:sfroofred 41a3:sfroofgrn 41a4:kuppa_ctr 41a5:kuppa 41a6:sfroom 41a7:togewood 41a8:sffloor00
41a9:sffloor00 41aa:sffloor00 41ab:sffloor00 41ac:sffloor00 41ad:sffloor00 41ae:sffloor00 41af:sffloor00
41b0:sffloor00 41b1:sffloor00 41b2:sffloor00 41b3:sffloor00 41b4:sfroof00 41b5:sfroof00 41b6:sfroof00
41b7:sfroof00 41b8:sfroof00 41b9:sfroof00 41c0:sfface0 41c1:sfface1 41c2:sfface2 41c3:sfface3 41c4:spinlift
41c5:stoplift 41c6:slug 41c7:flare 41c8:stream 41c9:jellyfish 41ca:hebibin0 41cb:hebibin1 41cc:hebibinr
41cd:hebibinl 41ce:qball 41cf:suimen 41d0:flare 41d1:bbl_apple 41d2:bbl_apple 41d3:bbl_apple 41d4:bbl_apple
41d5:bbl_apple 41d6:bbl_apple 41d7:bbl_apple 41d8:door 41d9:door_back 41da:hana 41db:hanaB 41dc:kuki
41dd:musi 41de:seisan 41df:seisan2 41e0:nameEntry 41e2:lift0 41e3:lift1 41e4:lift2 41e5:lift3 41e6:lift4
41e7:rdfork 41e8:rdfork 41e9:rdfork 41ea:rdfork 41eb:wind 41ec:unbb 41ed:nyororon 41ee:nyorlift
41ef:nyororon2 41f0:nyororon3 41f1:P_select0 41f2:P_select1 41f3:P_select2 41f4:P_select3 41f5:P_select4
41f6:P_select5 41f7:P_select6 41f8:P_select7 41f9:P_S_heiho 41fa:P_S_hand 41fb:P_S_shadow 41fc:P_selectOBJBG
41fd:tubo 41fe:tubo 41ff:tubo 4200:tubo 4201:tubo 4202:tubo 4203:tubo 4204:tubo 4205:tubo 4206:tubo 4207:tubo
4208:tubo 4209:tubo 420c:tubo 420f:tubo 4210:tubo 4212:tubo 4213:tubo 4214:tubo 4215:tubo 421c:tubo 4220:tubo
4225:tubo 4226:tubo 4227:tubo 4228:tubo 422c:tubo 4242:tubo 4243:tubo 4244:tubo 4246:tubo 4249:tubo 424a:tubo
4256:tubo 4257:tubo 4258:tubo 4259:tubo 425a:tubo 425b:tubo 425c:tubo 425d:tubo 425e:tubo 425f:tubo 4260:tubo
4261:tubo 4262:tubo 4263:tubo 4264:tubo 4265:tubo 4266:tubo 4267:tubo 4268:tubo 4269:tubo 426a:tubo 426b:tubo
426c:tubo 426d:tubo 426e:tubo 426f:tubo 4270:tubo 4271:tubo 4272:tubo 4273:tubo 4274:tubo 4275:tubo 4276:tubo
4277:tubo 4278:tubo 4279:tubo 427a:tubo 427b:tubo 427c:tubo 427d:tubo 427e:tubo 427f:tubo 4280:tubo 4281:tubo
4282:tubo 4283:tubo 4284:tubo 4285:tubo 4286:tubo 4287:tubo 4288:tubo 4289:tubo 428a:tubo 428b:tubo 428c:tubo
428f:tubo 4299:nextDoor 429a:nextDoor 429b:nextDoor 429e:nextDoor 42a0:nextDoor 42a1:nextDoor 42a2:nextDoor
42a3:nextDoor 42a4:nextDoor 42a5:nextDoor 42a7:nextDoor 42a8:nextDoor 42a9:nextDoor 42aa:nextDoor
42ab:nextDoor 42ac:nextDoor 42ad:nextDoor 42ae:nextDoor 42af:nextDoor 42b0:nextDoor 42b1:nextDoor
42b2:nextDoor 42b3:nextDoor 42b4:nextDoor 42b5:nextDoor 42b6:nextDoor 42b7:nextDoor 42b8:nextDoor
42b9:nextDoor 42ba:nextDoor 42bb:nextDoor 42bc:nextDoor 42bd:nextDoor 42be:nextDoor 42bf:nextDoor
42ea:nextDoor 42eb:nextDoor 42ec:nextDoor 42ee:nextDoor 42ef:nextDoor 42f0:nextDoor 42ff:nextDoor
4300:nextDoor 4301:nextKey 4302:pipelift 4340:pipelift 4341:pipelift 4344:pipelift 4345:pipelift
4346:pipelift 4347:pipelift 434a:pipelift 434b:pipelift 434c:pipelift 434d:pipelift 434e:pipelift
434f:pipelift 4350:pipelift 4351:pipelift 4352:pipelift 4353:pipelift 4354:pipelift 4355:pipelift
4356:pipelift 4357:pipelift 4358:pipelift 4359:pipelift 435a:pipelift 435b:pipelift 435d:pipelift
435e:pipelift 436a:pipelift 436b:pipelift 436c:pipelift 436d:pipelift 436e:pipelift 437f:pipelift
4381:pipelift 4382:pipelift 4395:pipeliftLR 4396:pipeliftLR 4397:pipeliftLR 4398:pipeliftLR 43ab:pipeliftLR
43ac:pipeliftLR 43ad:pipeliftLR 43ae:pipeliftLR 43c1:pipelift 43c2:pipelift 43c3:pipelift 43c4:pipelift
43c5:pipelift 43c6:pipelift 43c7:pipelift 43c8:pipelift 43c9:pipelift 43ca:pipelift 43cb:pipelift
43cc:pipelift 43cd:pipelift 43ce:pipelift 43cf:pipelift 43d0:pipelift 43d1:pipelift 43d2:pipelift
43d3:pipelift 43d4:pipelift 43d5:pipelift 43d6:pipelift 43d7:pipelift 43d8:pipelift 43d9:pipelift
43da:pipelift 43eb:pipelift3D 43ec:pipelift3D 43ed:pipelift3D 43ee:pipelift3D 43ef:pipelift3D 43f0:pipelift3D
43f1:pipelift3D 43f2:pipelift3D 43f3:pipelift3D 43f4:pipelift3D 43f5:pipelift3D 43f6:pipelift3D
43f7:pipelift3D 43f8:pipelift3D 43f9:pipelift3D 43fa:pipelift3D 43fb:pipelift3D 440b:pipenear 440c:pipenear
440d:pipenear 440e:pipenear 440f:pipenear 4410:pipeliftLR 4411:nextGate 444e:lrNextGate 444f:lrNextGate
4450:lrNextGate 4451:lrNextGate 4452:lrNextGate 4453:lrNextGate 4454:lrNextGate 4458:lrNextGate
4459:lrNextGate 445a:lrNextGate 4463:lrNextGate 4464:lrNextGate 4465:lrNextGate 4466:lrNextGate
4467:lrNextGate 4468:lrNextGate 4469:lrNextGate 446a:lrNextGate 446b:lrNextGate 448c:lrNextGate
448f:lrNextGate 4490:lrNextGate 4491:lrNextGate 4492:lrNextGate 4493:lrNextGate 4494:lrNextGate
4495:lrNextGate 449a:lrNextGate 449b:lrNextGate 449c:lrNextGate 44ac:lrNextGate 44ad:lrNextGate
44ae:lrNextGate 44af:lrNextGate 44b0:lrNextGate 44b1:lrNextGate 44b2:lrNextGate 44b3:lrNextGate
44b4:lrNextGate 44b5:lrNextGate 44ca:cyberGate 44cb:crossbox 44cc:title 44cd:lseesaw 44ce:bgswitch
44cf:bgswitch 44d0:breathhed 44d3:shipcontrol 44d4:lseesaw_end 44da:objvtx 44db:bgpolygon 44dc:bgpltest
44de:kemuri 44df:kemurir 44e1:obakelift 44e2:hoho_brd 44e3:raster 44e4:morph 44e7:jellyfish 44fd:suitekieye
44fe:sibuki 44ff:suitekibreed 4500:pendPole 4501:pendBolt 4502:pendKusari 4503:pendKariB 4504:dispcos
4505:manacos 4506:komorebi 4507:warp 4508:warp 4509:warp 450a:warp 450b:suimen 450c:fadeout 450d:suimen
450e:quartet 450f:maho 4510:mjugemu 4511:pukupuku 4513:mmizu 4514:srcstream 4515:roomkuppa 4516:muteki
4517:muteki 4518:muteki 4519:bgswitch 451a:bgswitch 451c:soratobi 451d:soratobi 451e:soratobi2 451f:soratobi2
4520:fujimifly 4521:fujimifly 4522:fujimifly2 4523:fujimifly2 4524:Coinblock 4525:hatibun 4526:hoho
4527:hatibun_brd 4528:hoho_brd 4529:spray 452a:bbl_apple 452b:bbl_apple 452c:bbl_apple 452d:bbl_apple
452e:bbl_apple 452f:bbl_apple 4530:bbl_apple 4531:hide 4532:heiho_f_group 4533:heiho_f_group
4534:heiho_f_group 4535:heiho_f_group 4536:zo 4537:zoleg 4538:pocket 4539:tarai 453a:yakan_baketu 453b:zobody
453c:luggageToss 453d:heiho_f_group 453e:knife 453f:knife 4540:knife 4541:knife 4542:knife 4543:knife
4544:knife 4545:heiho_f_group 4546:heiho_f_group 4547:bowerheiho 4548:bowerheiho 4549:bowerheiho
454a:bowerheiho 454b:bowerheiho 454c:bowerheiho 454d:bowerheiho 454e:bowerheiho 454f:eatboss 4550:eatpart
4551:eatfoot 4552:sfdokan 4553:sfdokan 4554:sfdokan 4555:saw 4556:fujimifly_ch 4557:daigabon 4558:dai_teasi
4559:kororin 455a:eatbosstie 455b:saw 455c:saw 455d:chibi 455e:sweat 455f:sweat_ctr 4560:minobon
4561:minobon_thread 4562:tibiunabon 4563:tibiunabon 4564:tibiunabon_body 4565:zopole 4567:chibi 4568:chibi
4569:hatibun_brd 456a:hatibun_brd 456b:hatibun_brd 456c:hatibun_brd 456d:hoho_brd 456e:hoho_brd 456f:hoho_brd
4570:hoho_brd 4571:togebonbody 4572:togebontail 4573:togebon0 4574:togebon1 4575:goron 4576:chibi 4577:chibi
4578:piston 4579:piston 457a:piston 457b:pistonOver 457c:puchi 457d:seed 457e:cotton 457f:puchi 4580:watage
4581:watage2 4582:iwa 4583:nyororon4 4584:killer_dodai_L 4585:killer_dodai_R 4586:killer_dodai_U
4587:killer_dodai_D 4588:killer_dodai_UL 4589:killer_dodai_UR 458a:killer_dodai_DL 458b:killer_dodai_DR
458c:killer_dodai_roll 458d:killer_dodai_srch 458e:killer_hou 458f:killer_tama 4590:zofoot 4591:kumolift_l
4592:kumolift_m 4593:kumolift_s 4594:unbb 4595:spring 4596:springOver 4597:obake 4598:obake 4599:puredeter
459a:puredeterbody 459b:puredeterface 459c:turumusi 459d:turumusibody 459e:turumusieye 459f:fruitSelect
45a0:jugei 45a1:bikkurin 45a2:bikkurin_partA 45a3:bikkurinbox 45a4:bikkurin_partB 45a5:jugemu 45a6:hirahira
45a7:hirappa 45a9:melon_no 45aa:takeuma_3u 45ab:takeuma_5u 45ac:takeuma_8u 45ad:takeuma 45ae:hoho_brd
45af:hoho_brd 45b0:hoho_brd 45b1:hoho_brd 45b2:hoho_brd 45b3:puroperah_All 45b4:puroperah_All 45b5:atamaheiho
45b6:P_man 45b7:snow_heiho 45b8:snowball 45b9:bbomb 45ba:eff_pachi 45bb:mienaiBlock 45bc:mienaimelon
45bd:mienaiPlace 45be:boat 45bf:enemymelon 45c0:enemyflower 45c1:poti 45c2:poti_tail 45c3:poti_pole
45c4:poti_chain 45c5:poti_up_move 45c6:poti_up_ri_down 45c7:poti_down_move 45c8:poti_down_le_up
45c9:poti_down_ri_up 45ca:poti_up_le_down 45cb:jugei 45cc:hoho_brd 45cd:hoho_brd 45ce:hoho_brd 45cf:hoho_brd
45d0:obakelift_head 45d1:hoho_brd 45d2:hoho_brd 45d3:hoho_brd 45d4:hoho_brd 45d5:hoho_brd 45d6:dokosa
45d7:forklift 45d8:wipeYoshi 45d9:jellyfish3 45da:f_select_moji 45db:f_select_back 45dc:srcstream 45dd:magma
45de:f_slct_apple 45df:f_slct_banana 45e0:f_slct_watermelon 45e1:f_slct_budou 45e3:dph 45e4:dph 45e5:dsn
45e6:swStep 45e7:swEgg 45e8:dsn 45e9:spray 45ea:lfsstand 45eb:bigbabru 45ec:minipuku 45ed:minipuku
45ee:brkblock 45ef:hahen 45f0:jugei 45f1:serpent 45f2:serhead 45f3:switchmelon 45f4:messageBOX 45f5:fide
45f6:melon_panel_01 45f7:melon_panel_02 45f8:melon_panel_03 45f9:melon_panel_04 45fa:melon_panel_05
45fb:melon_panel_06 45fc:melon_panel_07 45fd:melon_panel_08 45fe:melon_panel_09 45ff:melon_panel_10
4600:miniteresa 4601:miniteresa_n0 4602:miniteresa_brd 4603:brkblock 4604:brkblock 4605:frog 4606:kaeru
4607:slippy 4608:left_frog_waki 4609:left_kaeru_waki 460a:right_frog_waki 460b:right_kaeru_waki
460c:blackBoard 460d:blackBoardWaku 460e:swStep 460f:swStep 4615:swEgg 4616:swEgg 461c:bombBerry
461d:bombBerryGod 461e:big_frog 461f:small_kaeru 4620:potya 4621:hebinba_ctr 4622:hebinba_ctr
4623:hebinba_ctr 4624:hebinba_ctr 4625:hebinba 4626:hebinba_ch 4627:potya_ch 4628:sensuikan 4629:sensuiHire
462a:gyorai 462b:sensuiBody 462c:sensuiHire 462d:gyoraiParts 462e:gyoraiPuro 4631:teppou_puku 4632:teppou_gun
4633:dokap 4634:flyp 4635:flypbero 4636:hebinba_ctr 4637:hebinba_ch 4638:jugei 4639:casle 463a:tower
463b:namida 463c:kame_puro2 463d:koumori2 463e:kameku2 463f:kumo_ia 4640:ahoBakudan 4641:ahoBomb 4642:ahoLeg
4643:ahoBody 4644:ahoWing 4645:banboo_toge 4646:banboo_heiho 4647:bbl_apple 4648:ahoFuse 4649:flypbody
464a:flyphappa 464b:trsr_controll 464c:brkblock 464d:brkblock 464e:heiho 464f:hrdblock 4650:pokopoko
4651:suiryuawa 4652:kame_ashi 4653:swPara 4654:swParaKasa 4655:swEgg 4656:turesari0 4657:turesari1
4658:turesari2 4659:turesari3 465a:turesari4 465b:turesari5 465c:turesari6 465d:turesari7
465e:t_melon_panel_01 465f:t_melon_panel_02 4660:t_melon_panel_03 4661:t_melon_panel_04 4662:t_melon_panel_05
4663:t_melon_panel_06 4664:t_melon_panel_07 4665:t_melon_panel_08 4666:t_melon_panel_09 4667:t_melon_panel_10
4668:umv_llift 4669:lmv_llift 466a:hookBlock 466b:coin1 466c:flower 466d:tamagoSW 466e:kumolift_l
466f:kumolift_m 4670:kumolift_s 4671:kabeobake 4672:GAME_OVER_font 4673:P_selectFont 4674:seaanemone
4675:seafeler 4676:brkblock 4677:hebinba_ctr 4678:hebinba_ctr 4679:hebinba_ctr 467a:hebinba_ctr 467b:brkblock
467c:banboo_boss 467d:banboo_left 467e:banboo_right 467f:fire_heiho 4680:heiho_tubo 4681:tubo_flame
4682:up_castle_box 4683:down_castle_box 4684:TimeAttackStartBlock 4685:fire_heiho_boss 4686:kukiB
4687:uout_castle_box 4688:dout_castle_box 4689:flower 468a:stop_llift 468b:mdonguri 468c:drug 468d:bbl_apple
468e:bbl_apple 468f:bbl_apple 4690:bbl_apple 4691:bbl_apple 4692:bbl_apple 4693:bbl_apple 4694:bbl_apple
4695:deathWarp 4696:puroperah_All 4697:puroperah_All 4698:atamaheiho 4699:habaBlock 469a:luggageBlock
469b:odo 469c:b2p0 469d:b2p1 469e:b2p0 469f:b2p1 46a0:snapper 46a1:snapper 46a2:snapper 46a3:snapper
46a4:railSaw 46a5:railSaw 46a6:railSaw 46a7:railSaw 46a8:bbl_apple 46a9:bbl_apple 46aa:bbl_apple
46ab:bbl_apple 46ac:bbl_apple 46ad:bbl_apple 46ae:bbl_apple 46af:odoKakera 46b0:kabeobake_face
46b1:togewood_brd 46b2:odoTarget 46b3:odoTarget 46b4:odo 46b5:odo 46b6:odo 46b7:odo 46b8:odo 46b9:deathKey
46ba:fivestar 46bb:purikura 46bc:siiru1 46bd:siiru2 46be:siiru3 46bf:siiru4 46c0:siiru5 46c1:siiru6
46c2:siiru7 46c3:siiru8 46c4:siiru9 46c5:siiru10 46c6:siiru11 46c7:siiru12 46c8:siiru13 46c9:siiru14
46ca:siiru15 46cb:siiru16 46cc:siiru17 46cd:siiru18 46ce:siiru19 46cf:siiru20 46d0:siiru21 46d1:siiru22
46d2:siiru23 46d3:siiru24 46d4:railFruits 46d5:railFruits 46d6:railFruits 46d7:railFruits 46d8:odoTargetHata
46d9:odoTargetE 46da:hohofall 46db:heiho 46dc:heiho 46dd:heiho 46de:heiho 46df:heiho 46e0:heiho 46e1:odo
46e2:tuboSW 46e3:tuboSW 46e4:pakkunhana 46e5:kokoro 46e6:kokoronoMarchen 46e7:kokoronoMai 46e8:kokoronoMai
46e9:slctCarsol 46ea:poti_body 46eb:daigabon_body 46ec:banboo_chield 46ed:pocketStopBGM 46ee:inochi
46ef:inochinoHikari 46f0:inochinoYoin 46f2:inochinoTsugunai 46f3:inochinoGonge 46f4:eff_zzz
46f5:poti_walk_wait 46f6:poti_naname_end 46f7:purikuraHand 46f8:PC_hand_cntrl 46f9:slugeye 46fa:slime
46fb:ya_right 46fc:fill 46fd:clearGate 46fe:ya_left 46ff:ya_v_right 4700:ya_v_left 4701:ya_up 4702:ya_v_up
4703:ya_down 4704:ya_v_down 4705:ahoWakiWaki 4706:ahoBakudanGod 4707:ahoBakudan 4708:happytree 4709:hoho_brd
470a:shintaku 470f:slug 4710:handcos 4711:turemain 4712:turepuro 4713:turekame 4714:turetear 4715:tureboss
4716:awaawa 4717:awaawa 4718:goron_cheild 4719:okamoti_start_hata 471a:kokoronoMarchen 471b:pocket 471c:odo
471d:odo 471e:odo 471f:deathWarp 4720:deathWarp 4721:deathWarp 4722:bbl_apple 4723:bbl_apple 4724:bbl_apple
4725:cvey2 4726:cvey2puro 4727:cvey2yosi 4728:makuwauri 4729:cvey2heih 472a:poti2 472b:message7 472c:message8
472d:message9 472e:message10 472f:message11 4730:message12 4731:message13 4732:mdonguri 4733:melon_wanwan
4734:clearGate 4735:arrow 4736:arrow 4737:arrow 4738:arrow 4739:pauseFide 8002:wrd_3_2_chukan
8003:wrd_3_2_chukan 8004:wrd_3_2_chukan 8005:wrd_6_1_1_chukan 8006:wrd_6_1_2_chukan 8007:wrd_6_1_3_chukan
8008:wrd_6_1_4_chukan 8009:wrd_4_2_1_enkei 800a:jumptest 800b:wrd_4_2_2_enkei 800c:wrd_4_4_1_enkei
800d:wrd_4_4_2_enkei 800e:wrd_6_4_chukan 800f:wrd_6_4_chukan 8010:wrd_6_4_chukan 8011:wrd_6_4_chukan
8012:wrd_6_2_1 8013:wrd_6_2_2 8016:kupa_room 8017:wrd_1_3_3 8018:wrd_4_1_3_enkei 8019:wrd_4_1_4_enkei
801c:wrd_4_1_5_enkei 801d:wrd_4_1_6_enkei 801e:damybg 8020:wrd_4_1_7_enkei 8021:wrd_2_1_2 8022:wrd_5_2_1
8024:wrd_5_2_2 8026:wrd_1_2_2_enkei 8027:wrd_3_1_1_chukan 8028:wrd_3_1_2_chukan 8029:wrd_1_3_1_chukan
802a:wrd_1_3_2_chukan 802b:wrd_1_3_3_chukan 802c:wrd_3_1_3_chukan 802d:wrd_3_1_bonus_chukan
802e:wrd_1_3_1_enkei 802f:wrd_1_3_2_enkei 8030:wrd_1_3_3_enkei 8032:wrd_3_1_2 8033:wrd_3_1_bonus
8034:wrd_3_1_3 8035:wrd_2_4_1 8036:wrd_2_4_2 8037:wrd_2_4_3 8038:wrd_2_4_4 8039:wrd_2_4_5 803b:wrd_2_4_6
803c:wrd_2_4_1_enkei 803d:wrd_2_4_2_enkei 803e:wrd_2_4_3_enkei 803f:wrd_2_4_4_enkei 8040:wrd_2_4_5_enkei
8043:wrd_2_4_6_enkei 8044:wrd_6_2_3 8045:enmyTestBG 8046:wrd_5_2_1_enkei 804a:titleBG 804b:BGMoji
804c:wrd_2_3_1 804d:wrd_2_3_1_enkei 804e:wrd_2_3_2 804f:wrd_2_3_2_enkei 8050:wrd_4_1_3 8052:wrd_4_1_4
8053:wrd_4_1_5 8054:wrd_4_1_6 8055:wrd_4_1_7 8056:wrd_6_3_1 8057:wrd_6_3_2 8058:wrd_6_3_3 805a:wrd_6_3_4
805b:wrd_6_3_5 805c:wrd_6_3_6 805d:wrd_6_3_7 805e:wrd_6_3_8 805f:wrd_6_3_9 8060:wrd_6_3_10 8061:wrd_6_2_4
8062:wrd_6_2_5 8063:wrd_5_2_1_chukan 8064:wrd_4_4_1 8065:wrd_4_4_2 8066:kumo_boss_enkei 8067:wrd_1_1_1
8068:wrd_1_1_2 8069:wrd_2_1_1 806a:wrd_2_1_chukan 806b:wrd_3_1_1 806c:wrd_3_1_1_enkei 806d:wrd_3_1_2_enkei
806e:wrd_3_1_3_enkei 806f:wrd_3_1_bonus_enkei 8070:wrd_1_2_1 8071:wrd_1_2_2 8072:wrd_1_2_1_enkei
8073:wrd_4_3_1_kinkei 8074:wrd_4_3_1 8075:wrd_4_3_1_enkei 8076:wrd_4_3_2_kinkei 8077:wrd_4_3_2
8078:wrd_4_3_2_enkei 8079:wrd_6_1_1 807a:wrd_6_1_2 807b:wrd_6_1_3 807c:wrd_6_1_4 807d:wrd_1_4_1
807e:wrd_1_4_2 807f:wrd_1_4_3 8080:wrd_1_4_4 8081:wrd_1_4_chukan 8082:wrd_1_4_2_enkei 8083:wrd_1_4_chukan
8084:wrd_1_4_chukan 8085:wrd_2_2_1 8086:wrd_2_2_2 8087:wrd_2_2_1_enkei 8088:wrd_2_2_2_enkei 8089:wrd_5_1_0
808a:wrd_5_1_0_chukan 808b:wrd_5_1_0_enkei 808c:wrd_5_1_1 808d:wrd_5_1_1_chukan 808e:wrd_5_1_1_enkei
808f:wrd_5_1_2 8091:wrd_5_1_2_enkei 8092:wrd_5_1_3 8093:wrd_5_1_3_chukan 8094:wrd_5_1_3_enkei 8095:wrd_3_3_1
8096:wrd_3_3_1_chukan 8097:wrd_3_3_1_enkei 8098:wrd_3_3_2_1 8099:wrd_3_3_2_2 809a:wrd_3_3_2_3
809b:wrd_3_3_2_4 809c:wrd_3_3_2_5 809d:wrd_3_3_2_6 809e:wrd_3_3_2_chukan 809f:wrd_3_3_2_enkei
80a0:wrd_3_3_2_7 80a1:wrd_3_3_2_7_chukan 80a2:wrd_3_3_2_7_enkei 80a3:wrd_3_3_2_8 80a4:wrd_4_2_1
80a5:wrd_4_2_2 80a6:wrd_4_1_2 80a7:wrd_4_1_2_mask 80a8:wrd_4_1_2_enkei 80a9:wrd_4_1_1 80aa:wrd_4_1_1_enkei
80ab:wrd_6_4_1 80ac:wrd_6_4_2 80ad:wrd_6_4_3 80ae:wrd_6_4_4 80af:wrd_5_4_1 80b0:wrd_5_4_1_chukan
80b1:wrd_5_4_1_enkei 80b2:wrd_5_4_2 80b3:wrd_5_4_2_chukan 80b4:wrd_5_4_2_enkei 80b5:wrd_3_2_1 80b6:wrd_3_2_2
80b7:wrd_3_2_3 80b8:wrd_1_1_1_chukan 80b9:wrd_1_1_1_enkei 80ba:wrd_1_1_2_enkei 80bb:wrd_1_2_1_chukan
80bc:wrd_1_3_1 80bd:wrd_1_3_2 80be:wrd_3_4_1 80bf:wrd_3_4_1_chukan 80c0:wrd_3_4_1_enkei 80c1:wrd_3_4_2
80c2:wrd_3_4_2_chukan 80c3:wrd_3_4_2_enkei 80c4:wrd_5_3_1 80c5:wrd_5_3_2 80c6:wrd_5_3_3 80c7:wrd_1_2_2_chukan
80c8:wrd_4_3_0 80c9:wrd_6_3_1_enkei 80ca:wrd_6_3_2_enkei 80cb:wrd_6_3_3_enkei 80cc:wrd_6_3_4_enkei
80cd:wrd_6_3_5_enkei 80ce:wrd_6_3_6_enkei 80cf:wrd_6_3_7_enkei 80d0:wrd_6_3_8_enkei 80d1:wrd_6_3_9_enkei
80d2:wrd_6_3_10_enkei 80d3:wrd_6_2_1_enkei 80d4:wrd_6_2_2_enkei 80d5:wrd_6_2_3_enkei 80d6:wrd_6_2_4_enkei
80d7:wrd_6_2_5_enkei 80d8:wrd_1_1_2_chukan 80d9:wrd_5_3_1_chukan 80da:wrd_5_3_1_enkei 80db:wrd_5_3_2_chukan
80dc:wrd_5_3_2_enkei 80dd:wrd_5_3_3_chukan 80de:wrd_5_3_3_enkei 80df:wrd_5_2_2_chukan 80e0:wrd_5_2_2_enkei
80e1:bs_habatobi 80e2:bs_habatobi_chukan 80e3:bs_habatobi_enkei 80e4:bs_okmti_packn 80e5:bs_okmti_hajimete
80e6:wrd_2_1_3 80e7:bs_okmti_heiho 80e8:wrd_2_3_3 80e9:bs_okmti_kaidan 80ea:bs_haba_hajimete
80eb:wrd_4_3_0_kinkei 80ec:wrd_4_3_0_enkei 80ed:bs_okmti_packn_kinkei 80ee:bs_okmti_packn_enkei
80ef:wrd_5_2_3 80f0:wrd_5_2_3_chukan 80f1:wrd_5_2_3_enkei 80f2:bs_okmti_saka 80f3:bs_yoidon_slider
80f4:wrd_0_1 80f5:wrd_0_1_chukan 80f6:wrd_0_1_enkei 80f7:wrd_6_2_6 80f8:kupa_room_enkei
80f9:bs_okmti_hajimete_chukan 80fa:bs_okmti_hajimete_enkei 80fb:bs_yoidon_slider_enkei 80fc:wrd_2_3_3_enkei
80fd:bs_okmti_kaidan_enkei 80fe:bs_haba_hajimete_enkei 80ff:bs_okmti_saka_chukan 8100:bs_okmti_saka_enkei
8101:bs_okmti_heiho_chukan 8102:bs_okmti_heiho_enkei 8103:wrd_6_2_6_enkei 8104:bs_yoidon_hock
8105:bs_yoidon_hock_chukan 8106:bs_yoidon_hock_enkei 8107:bs_yoidon_knife 8108:bs_yoidon_knife_enkei
8109:wrd_4_1_4_mask 810a:wrd_3_3_2_8_enkei 810b:wrd_1_3_4 810c:wrd_1_3_4_chukan 810d:wrd_1_3_4_enkei
810e:bs_yoidon_swim 810f:bs_yoidon_swim_enkei 8110:boss_donbaba 8111:boss_donbaba_enkei 8112:boss_predator
8113:boss_predator_enkei 8114:boss_kumo 8115:boss_kumo_enkei 8116:boss_kumo_enkei 8117:boss_majin
8118:boss_majin_enkei 8119:wrd_5_2_0 811a:wrd_5_2_0_chukan 811b:wrd_5_2_0_enkei 811c:wrd_3_3_2_9
811d:wrd_3_3_2_9_enkei 811e:wrd_2_1_4 811f:wrd_5_2_4 8120:wrd_5_2_4_chukan 8121:wrd_5_2_4_enkei
8122:wrd_5_2_5 8123:wrd_5_2_5_enkei 8124:wrd_3_1_4 8125:wrd_3_1_4_chukan 8126:wrd_3_1_4_enkei 8127:wrd_6_4_5
8128:wrd_6_4_chukan
`;

const WORLD_NAME_TEXT = `
worldNintendo worldNameEntry2 worldP_select worldSeisan worldPanorama worldFruitSelect worldSeisan2
worldNameEntry worldTuresariDemo worldPurikura worldShintaku worldTester world_4_3_0 world_1_3_1 world_3_4_1
world_6_1_1 world_2_3_1 world_4_1_1 world_1_4_1 world_2_2_1 worldBossSeisan world_5_1_1 world_4_2_1
world_2_4_1 world_6_4_1 world_0_1 worldBossSeisan2 world_4_4_1 world_5_4_1 worldGameOver world_5_2_1
world_5_3_1 world_3_3_1 worldTester world_6_3_1 world_6_2_1 worldHashi worldDrum worldTester worldBosstest
world_3_2_1 worldPcAmerica worldPcFrench world_1_1_1 worldPcGermany worldTester world_2_1_1 worldTester
worldTester worldTester worldTester world_1_2_1 world_3_1_1 worldTester worldTester worldTester worldTester
worldTester worldTester worldTester worldTester worldTester worldTester worldTester worldTester worldTester
worldKumo_boss_enkei worldTester worldTester worldTester worldTester worldTester worldTester worldTester
worldTester worldEscape worldNigeruKuppa worldTester worldKupa_room worldClearDemo worldPanorama world_1_1_2
world_3_1_2 world_3_1_bonus world_3_1_3 world_1_2_2 world_4_3_2 world_6_1_2 world_6_1_3 world_6_1_4
world_1_4_2 world_1_4_3 world_1_4_4 world_2_2_2 world_5_1_2 world_5_1_3 world_5_1_4 world_4_2_2 world_6_4_2
world_6_4_3 world_6_4_4 world_5_4_2 world_3_2_2 world_3_2_3 world_1_3_2 world_3_4_2 world_2_3_2 world_2_4_2
world_2_4_3 world_2_4_4 world_2_4_5 world_2_4_6 world_4_1_2 world_4_1_3 world_4_1_4 world_4_1_5 world_4_1_6
world_4_1_7 world_4_4_2 world_1_3_3 world_2_1_2 world_5_2_2 world_5_3_2 world_5_3_3 world_3_3_2_1
world_3_3_2_2 world_3_3_2_3 world_3_3_2_4 world_3_3_2_5 world_3_3_2_6 world_3_3_2_7 world_3_3_2_8 world_6_3_2
world_6_3_3 world_6_3_4 world_6_3_5 world_6_3_6 world_6_3_7 world_6_3_8 world_6_3_9 world_6_3_10 world_6_2_2
world_6_2_3 world_6_2_4 world_6_2_5 world_4_3_1 worldBs_habatobi worldBs_okmti_packn worldBs_okmti_hajimete
worldBs_okmti_heiho worldBs_okmti_kaidan world_2_3_3 worldBs_haba_hajimete world_2_1_3 world_5_2_3
worldBs_okmti_saka worldBs_yoidon_slider world_6_2_6 worldBs_yoidon_hock worldBs_yoidon_knife world_1_3_4
worldBs_yoidon_swim worldBoss_kumo worldBoss_majin worldBoss_predator worldBoss_donbaba world_5_2_0
worldKupa_room2 worldKupa_room3 worldKupa_room4 world_3_3_2_9 world_2_1_4 world_5_2_4 world_5_2_5 world_3_1_4
world_6_4_5
`;

export const CAST_NAMES = new Map<number, string>(
  CAST_NAME_TEXT.split(/\s+/).filter(Boolean).map((e) => { const [id, name] = e.split(':'); return [parseInt(id, 16), name]; }),
);

export const WORLD_NAMES: string[] = WORLD_NAME_TEXT.split(/\s+/).filter(Boolean);
