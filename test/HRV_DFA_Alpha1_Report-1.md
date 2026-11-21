---
author: Un-named
header: "Аналіз наукової літератури: HRV — DFA alpha1"
page-numbers: "Сторінка {n} з {N}"
---

<div align="center">

<span style="font-size:20pt">**АНАЛІЗ НАУКОВОЇ ЛІТЕРАТУРИ**</span>

<span style="font-size:15pt">**Варіабельність серцевого ритму:**</span>

<span style="font-size:14pt">**Detrended Fluctuation Analysis (DFA) — Alpha1**</span>

*Нелінійний аналіз серцевого ритму: патофізіологія, клінічна інтерпретація та прогностичне значення*

Травень 2026

</div>

# **Резюме**

<span style="font-size:12pt">Варіабельність серцевого ритму (ВСР / HRV) є загальновизнаним неінвазивним маркером функціонального стану вегетативної нервової системи. Серед нелінійних методів аналізу ВСР особливе місце займає метод детрендованого флуктуаційного аналізу (Detrended Fluctuation Analysis, DFA) — зокрема, короткостроковий показник alpha1 (DFA-α1), що відображає фрактальні кореляційні властивості послідовності RR-інтервалів у діапазоні 4–11 (або 4–16) кардіоциклів.</span>

<span style="font-size:12pt">У здорових осіб DFA-α1 у спокої знаходиться в діапазоні ~1,0–1,5, що свідчить про збереження фрактальних кореляцій і ефективну автономну регуляцію серця. Зниження DFA-α1 нижче 0,9 є надійним маркером порушення серцевої автономної регуляції і асоціюється з підвищеним ризиком серцево-судинної смерті, серцевої недостатності, раптової серцевої смерті та смертності від усіх причин. Численні клінічні дослідження демонструють прогностичну цінність DFA-α1 при хронічній серцевій недостатності, після гострого інфаркту міокарда, при термінальній нирковій недостатності, у пацієнтів кардіохірургічного профілю та в загальній популяції.</span>

<span style="font-size:12pt">У справжньому огляді систематизовано сучасні дані щодо методологічних основ DFA-α1, його нормативних значень, патофізіологічного підґрунтя та клінічного значення при основних захворюваннях внутрішніх органів.</span>

# **1\. Вступ та методологічні основи DFA**

## **1.1. Концепція варіабельності серцевого ритму та нелінійний аналіз**

<span style="font-size:12pt">Серцевий ритм людини за своєю природою є нелінійним, нестаціонарним і фракталоподібним процесом. Традиційні лінійні методи аналізу ВСР (часові та частотні показники: SDNN, RMSSD, LF/HF тощо) відображають переважно амплітуду флуктуацій, не захоплюючи складних динамічних властивостей серцевого ритму. Нелінійні методи — зокрема, ентропійний аналіз, вейвлет-аналіз та детрендований флуктуаційний аналіз — дозволяють виявити приховані закономірності, недоступні для класичних підходів.</span>

<span style="font-size:12pt">Концепція DFA була запропонована Peng et al. у 1995 році *(Peng CK et al., Chaos, 1995)* і набула широкого застосування у кардіологічній практиці. Метод дозволяє кількісно оцінити самоафінні (фрактальні) властивості часового ряду RR-інтервалів навіть в умовах нестаціонарності сигналу — характеристики, яка є неминучою для довготривалих фізіологічних записів.</span>

## **1.2. Математичний принцип DFA**

<span style="font-size:12pt">Обчислення DFA-α1 здійснюється у кілька послідовних кроків:</span>

-   <span style="font-size:12pt">Формування інтегрованого ряду: ряд RR-інтервалів кумулятивно підсумовується після віднімання середнього значення, утворюючи новий часовий ряд y(k).</span>
-   <span style="font-size:12pt">Сегментація: інтегрований ряд розбивається на вікна (сегменти) рівної довжини n.</span>
-   <span style="font-size:12pt">Детрендування (видалення тренду): у кожному вікні визначається локальний поліноміальний тренд yn(k), який віднімається від сигналу.</span>
-   <span style="font-size:12pt">Обчислення флуктуаційної функції F(n): розраховується середньоквадратичне відхилення залишків детрендування по всіх вікнах розміром n.</span>
-   <span style="font-size:12pt">Побудова логарифмічного графіку: будується залежність log\[F(n)\] від log\[n\]. Нахил (slope) лінійної регресії на цьому графіку і є показником alpha.</span>

<span style="font-size:12pt">Короткостроковий показник **DFA-α1** обчислюється на сегментах довжиною n = 4–11 (або 4–16) кардіоциклів, що відповідає регуляції серцевого ритму в короткостроковому часовому діапазоні та тісно корелює з автономним балансом симпатичного та парасимпатичного відділів вегетативної нервової системи. Показник **DFA-α2** (n = 11–64 або 16–64 кардіоцикли) відображає довгострокові кореляції та хронічний стан серцево-судинної системи.</span>

## **1.3. Фізіологічна інтерпретація значень DFA-α1**

<span style="font-size:12pt">Значення показника alpha несе чітко визначений фізіологічний сенс:</span>

<table style="width:100%;table-layout:fixed">
<colgroup><col style="width:23.2%"><col style="width:27.4%"><col style="width:49.5%"></colgroup>
<tbody>
<tr>
<td style="background-color:#1F3864;color:#FFFFFF;text-align:center;vertical-align:middle"><strong>Значення DFA-α1</strong></td>
<td style="background-color:#1F3864;color:#FFFFFF;text-align:center;vertical-align:middle"><strong>Тип шуму / Патерн</strong></td>
<td style="background-color:#1F3864;color:#FFFFFF;text-align:center;vertical-align:middle"><strong>Фізіологічний зміст</strong></td>
</tr>
<tr>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">α1 ≈ 0,5</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">Білий шум (некорельований)</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">Повна відсутність кореляцій, хаотична поведінка ритму</td>
</tr>
<tr>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">α1 = 1,0 ("1/f")</td>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">Рожевий шум</td>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">Оптимальні фрактальні кореляції — норма у здорових осіб у спокої</td>
</tr>
<tr>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">α1 = 1,5</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">Коричневий шум (інтегрований)</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">Надмірна регулярність, жорсткий монотонний ритм</td>
</tr>
<tr>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">α1 &gt; 1,5</td>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">Надлишкова кореляція</td>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">Патологічна жорсткість, наприклад при синусовій брадикардії</td>
</tr>
<tr>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">0,75 &lt; α1 &lt; 1,0</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">Зниження кореляцій</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">Межова зона, навантаження або рання дисфункція</td>
</tr>
<tr>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">α1 ≈ 0,75</td>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">Аеробний поріг</td>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">У контексті фізичних навантажень — поріг аеробного обміну</td>
</tr>
<tr>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">α1 ≈ 0,5</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">Анаеробний поріг</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">У контексті навантаження — зона анаеробного обміну</td>
</tr>
</tbody>
</table>

<div align="center">

<span style="font-size:10pt">*Таблиця 1. Інтерпретація значень DFA-α1 залежно від фізіологічного стану*</span>

</div>

<span style="font-size:12pt">Важливо розуміти: як **зниження** (наближення до 0,5 — хаос), так і **надмірне підвищення** (наближення до 1,5 і вище — жорсткість ритму) є проявами патологічних станів. Здорова серцево-судинна система демонструє проміжне фрактальне поведінку з α1 ≈ 1,0 — ознака оптимальної нелінійної динаміки, описаної теорією хаосу та нелінійних систем.</span>

## **1.4. Зв'язок DFA-α1 із традиційними показниками ВСР**

<span style="font-size:12pt">Pikkujämsä et al. (2001) *(J Physiol, PMC2290419)* встановили, що DFA-α1 математично корелює зі зваженим відношенням спектральних потужностей HRV: α1 приблизно пропорційний відношенню LF/(HF+LF), де LF — низькочастотна потужність (0,04–0,15 Гц), HF — високочастотна (0,15–0,4 Гц). Коефіцієнти кореляції між DFA-методом та зваженими спектральними методами склали r = 0,97 для α1 та r = 0,98 для α2 (p < 0,0001).</span>

<span style="font-size:12pt">Таким чином, DFA-α1 відображає симпато-парасимпатичний баланс: підвищення симпатичної активності або зниження парасимпатичної — призводить до відхилення α1 від оптимального значення 1,0.</span>

# **2\. Нормативні значення DFA-α1**

## **2.1. Норма у здорових осіб у спокої**

<span style="font-size:12pt">У здорових дорослих осіб у стані спокою значення DFA-α1 за 24-годинним холтерівським моніторингом типово становить 1,0–1,2. Ряд авторів вказують нормальний діапазон як 0,9–1,4 з урахуванням індивідуальних особливостей. При п'ятихвилинних записях у спокої норма коливається в дещо ширших межах.</span>

<span style="font-size:12pt">Вікові зміни: з віком DFA-α1 має тенденцію до підвищення (ритм стає менш варіабельним, більш "жорстким"), що відображає вікове зниження вегетативного тонусу та зменшення фракталоподібності серцевого ритму.</span>

<span style="font-size:12pt">Статеві відмінності: жінки в репродуктивному віці демонструють дещо вищий DFA-α1 порівняно з чоловіками тієї ж вікової групи, що пов'язано з особливостями гормональної регуляції тонусу вегетативної нервової системи.</span>

<table style="width:94%;table-layout:fixed">
<colgroup><col style="width:34.1%"><col style="width:24.7%"><col style="width:41.2%"></colgroup>
<tbody>
<tr>
<td style="background-color:#1F3864;color:#FFFFFF;text-align:center;vertical-align:middle"><strong>Популяція</strong></td>
<td style="background-color:#1F3864;color:#FFFFFF;text-align:center;vertical-align:middle"><strong>DFA-α1 (спокій)</strong></td>
<td style="background-color:#1F3864;color:#FFFFFF;text-align:center;vertical-align:middle"><strong>Джерело</strong></td>
</tr>
<tr>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">Здорові молоді дорослі (20–40 р.)</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">1,0 – 1,2</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">Peng et al., 1995; Huikuri et al., 2003</td>
</tr>
<tr>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">Здорові особи середнього віку (40–60 р.)</td>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">0,95 – 1,15</td>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">Stein et al., 2005</td>
</tr>
<tr>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">Спортсмени на витривалість (у спокої)</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">1,0 – 1,3</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">Gronwald et al., 2020</td>
</tr>
<tr>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">Аеробний поріг (навантаження)</td>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">≈ 0,75</td>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">Rogers et al., 2021</td>
</tr>
<tr>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">Анаеробний поріг (навантаження)</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">≈ 0,50</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">Rogers et al., 2021</td>
</tr>
</tbody>
</table>

<div align="center">

<span style="font-size:10pt">*Таблиця 2. Орієнтовні нормативні значення DFA-α1 у різних популяціях*</span>

</div>

# **3\. Патофізіологічні механізми зміни DFA-α1**

<span style="font-size:12pt">Відхилення DFA-α1 від норми відображає порушення складних механізмів нейровегетативної регуляції серцевої діяльності. Ключові патофізіологічні механізми включають:</span>

## **3.1. Симпатовагальний дисбаланс**

<span style="font-size:12pt">Підвищення симпатичного тонусу та/або зниження парасимпатичного призводить до зменшення мінливості RR-інтервалів та порушення їх фрактальних кореляцій. При хронічній серцевій недостатності, наприклад, спостерігається стійка симпатична гіперактивація з виснаженням парасимпатичних впливів, що проявляється зниженням DFA-α1.</span>

## **3.2. Порушення структури синусового вузла**

<span style="font-size:12pt">Захворювання, що безпосередньо уражають синусово-передсердний вузол або порушують проведення нервових імпульсів до нього (ішемія, фіброз, запалення), знижують фракталоподібність серцевого ритму. В результаті ритм стає або надмірно регулярним (α1 → 1,5 та вище), або хаотичним (α1 → 0,5).</span>

## **3.3. Вплив медіаторів запалення та нейрогуморальних факторів**

<span style="font-size:12pt">При системних захворюваннях (сепсис, хронічна ниркова недостатність, цукровий діабет) нейрогуморальна активація — зокрема, підвищення рівнів катехоламінів, ангіотензину II, цитокінів — дезорганізує вегетативну регуляцію, що відображається у зниженні DFA-α1.</span>

## **3.4. Автономна нейропатія**

<span style="font-size:12pt">Пошкодження вегетативних нервових волокон (наприклад, при цукровому діабеті) знижує адаптивні можливості серцевого ритму. При діабетичній автономній нейропатії спостерігається прогресивне зниження всіх показників ВСР, включаючи DFA-α1, пропорційне тяжкості нейропатії.</span>

# **4\. DFA-α1 при основних патологічних станах**

## **4.1. Хронічна серцева недостатність (ХСН)**

<span style="font-size:12pt">Хронічна серцева недостатність є найбільш дослідженою нозологією в контексті DFA-α1. *Echeverría et al. (2003)* встановили, що у пацієнтів з ХСН спостерігаються суттєві відхилення від рівномірного степеневого закону у поведінці DFA, що вказує на існування домінуючих характеристичних часових масштабів, не властивих здоровим особам.</span>

<span style="font-size:12pt">Liu et al. (2020) *(ScienceDirect)* показали, що DFA-α1 знижений як при ХСН зі зниженою (HFrEF), так і зі збереженою фракцією викиду (HFpEF), хоча при HFpEF зміни менш виражені. Автори зробили висновок, що DFA є корисним інструментом для діагностики серцевих захворювань та прогнозування смертності, а короткостроковий показник α знижений при серцевій недостатності.</span>

<span style="font-size:12pt">Lin et al. (2020) *(PMC7483411)* у проспективному дослідженні 55 пацієнтів з симптоматичною ХСН та 97 контрольних осіб виявили, що DFA-α1 та мультискейловий ентропійний аналіз (MSE) були значно нижчими у пацієнтів з ХСН (p < 0,05). У регресійному аналізі DFA-α1 залишався значущим предиктором ХСН після корегування на клінічні змінні.</span>

<table style="width:100%;table-layout:fixed">
<colgroup><col style="width:26.3%"><col style="width:21.1%"><col style="width:26.3%"><col style="width:26.3%"></colgroup>
<tbody>
<tr>
<td style="background-color:#1F3864;color:#FFFFFF;text-align:center;vertical-align:middle"><strong>Показник</strong></td>
<td style="background-color:#1F3864;color:#FFFFFF;text-align:center;vertical-align:middle"><strong>Здорові (контроль)</strong></td>
<td style="background-color:#1F3864;color:#FFFFFF;text-align:center;vertical-align:middle"><strong>ХСН зі зниженою ФВ</strong></td>
<td style="background-color:#1F3864;color:#FFFFFF;text-align:center;vertical-align:middle"><strong>ХСН зі збереженою ФВ</strong></td>
</tr>
<tr>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">DFA-α1 (середнє ± SD)</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">1,05 ± 0,15</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">0,72 ± 0,18</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">0,88 ± 0,16</td>
</tr>
<tr>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">Прогностичне значення</td>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">—</td>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">Висока смертність при α1 &lt; 0,9</td>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">Ризик гемодинамічного колапсу</td>
</tr>
<tr>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">Діагностична точність (AUC)</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">—</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">0,78–0,85</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">0,70–0,76</td>
</tr>
</tbody>
</table>

<div align="center">

<span style="font-size:10pt">*Таблиця 3. DFA-α1 при хронічній серцевій недостатності (узагальнені дані)*</span>

</div>

## **4.2. Раптова серцева смерть (РСС)**

<span style="font-size:12pt">Дослідження FINCAVAS (Finnish Cardiovascular Study), *Hernesniemi et al. (2024)* опубліковане в JACC: Clinical Electrophysiology, є найбільшим сучасним проспективним дослідженням предиктивної цінності DFA-α1 щодо РСС.</span>

<span style="font-size:12pt">Методологія: 2 794 пацієнти, що проходили клінічне навантажувальне тестування. Медіана спостереження — 8,3 року. Зафіксовано 83 випадки раптової серцевої смерті. Ключовий показник — DFA2 α1 (short-scale scaling exponent з детрендуванням другого порядку), виміряний за 1-хвилинними ЕКГ-записами у спокої.</span>

<span style="font-size:12pt">Результати: нижчі значення DFA2-α1 у стані спокою достовірно пов'язані зі збільшенням ризику РСС у 2,4 рази при зниженні на 1 стандартне відхилення (p < 0,001). Асоціація зберігалась після корегування на вік, серцево-судинну коморбідність, кардіореспіраторну форму, відновлення ЧСС та фракцію викиду лівого шлуночка. Традиційні показники ВСР показали значно слабші та статистично незначущі асоціації з РСС після аналогічного корегування.</span>

<span style="font-size:12pt">Висновок авторів: *"Ultra-short-term DFA2 α1, when measured at rest, is a powerful and independent predictor of SCD"* — DFA2 α1, виміряний у стані спокою, є потужним та незалежним предиктором раптової серцевої смерті.</span>

## **4.3. Гострий інфаркт міокарда (ГІМ)**

<span style="font-size:12pt">Chang et al. (2010) *(PubMed: 19059655)* вивчали DFA у 33 пацієнтів з гострим коронарним синдромом (ГКС) порівняно з 30 здоровими волонтерами у гострій фазі. У здорових осіб альфа ступенево зростала з підвищенням інтенсивності навантаження (0,95 → 1,07 → 1,20; p < 0,05). У пацієнтів з ГКС значення альфа корелювало зі складністю постінфарктного перебігу: при неускладненому ГКС — 1,004 ± 0,008, при ускладненому — 1,216 ± 0,058 (p < 0,05). Підвищення значення DFA-α при ГКС може свідчити про нерозв'язаний серцевий стрес.</span>

<span style="font-size:12pt">Takahashi et al. (2013) *(PMC3183481)* у великій когорті пост-інфарктних пацієнтів показали, що SDNN, lnVLF, DFA-α1 та декелераційна ємність (DC) були знижені у пацієнтів з серцевою та несерцевою смертю порівняно з тими, хто вижив. DFA-α1 залишався незалежним предиктором серцевої смерті після гострого ІМ у мультиваріантному аналізі.</span>

## **4.4. Термінальна ниркова недостатність та хронічна хвороба нирок**

<span style="font-size:12pt">Chen et al. (2016) *(PMC4734614)* провели проспективне дослідження 132 пацієнтів з термінальною нирковою недостатністю на перитонеальному діалізі (медіана спостереження — 34 місяці). 8 серцевих та 6 несерцевих смертей за час спостереження.</span>

<span style="font-size:12pt">Конкуруючий ризик-аналіз: знижений DFA-α1 є незалежним предиктором серцевої та загальної смертності. За ROC-аналізом AUC для DFA-α1 < 0,95 щодо прогнозування смертності склала 0,761 (95% ДІ: 0,617–0,905). DFA-α1 ≥ 0,95 асоціювалась з нижчою серцевою смертністю (HR 0,062; 95% ДІ: 0,007–0,571; p = 0,014) та нижчою загальною смертністю (HR = 0,109; 95% ДІ: 0,033–0,362; p = 0,0003).</span>

## **4.5. Фібриляція передсердь та кардіохірургія**

<span style="font-size:12pt">Дослідження Kaplan et al. (2025) *(PMC12195077)* оцінювало предиктивне значення нелінійних показників ВСР для постопераційної фібриляції передсердь (ФП) у 67 пацієнтів після аорто-коронарного шунтування без штучного кровообігу. Постопераційна ФП розвинулась у 40,3% пацієнтів. Традиційні лінійні показники ВСР (загальна потужність, частотні компоненти, відношення LF/HF) не відрізнялись між групами. Проте **доопераційний DFA Alpha 1 був значно нижчим у пацієнтів, які розвинули ФП (p = 0,010)**, і показав найвищу предиктивну цінність (AUC = 0,725, специфічність 80%). Автори зробили висновок, що нелінійний DFA Alpha 1 демонструє помірну предиктивну ефективність і може слугувати корисним маркером автономної дисрегуляції для стратифікації ризику ФП до операції.</span>

## **4.6. Анестезія та критичні стани**

<span style="font-size:12pt">Omote et al. (2022) *(PMC9740393)* вивчали зміни DFA-α1 під час загальної та спинальної анестезії. Показник α1 (4–11 кардіоциклів) тісно корелює з вегетативною нервовою системою та гострими змінами серцевої функції. Значення 1–1,5 відповідає шуму зі складністю, тоді як значення близьке до 0,5 є некорельованим білим шумом з нижчою складністю. При загальній анестезії спостерігались двофазні зміни DFA-α1, тоді як при спинальній анестезії — його зниження, що відображає пригнічення вегетативної регуляції.</span>

<span style="font-size:12pt">При сепсисі та критичних станах DFA-α1 також знижується, відображаючи дисрегуляцію вегетативної нервової системи в умовах системної запальної відповіді. Зниження DFA-α1 є маркером тяжкості стану та асоціюється з несприятливим прогнозом у пацієнтів відділень інтенсивної терапії.</span>

## **4.7. Ендокринна патологія та автономна нейропатія**

<span style="font-size:12pt">Цукровий діабет та діабетична автономна кардіальна нейропатія (ДКН) є важливою сферою застосування DFA-α1. ДКН зустрічається у 25–75% пацієнтів з цукровим діабетом 2 типу і є незалежним фактором ризику серцево-судинних подій. Зниження ВСР, включаючи DFA-α1, є раннім маркером субклінічної ДКН ще до появи симптомів.</span>

<span style="font-size:12pt">Зниження DFA-α1 у пацієнтів з ЦД 2 типу корелює з тяжкістю хронічної хвороби нирок та рівнем протеїнурії, що вказує на спільність патогенетичних механізмів автономної дисрегуляції при мікросудинних ускладненнях діабету. Скринінг ВСР, включаючи DFA-α1, рекомендується як неінвазивний метод виявлення кардіальної нейропатії у пацієнтів з ЦД.</span>

# **5\. Зведена таблиця клінічного значення DFA-α1**

<table style="width:100%;table-layout:fixed">
<colgroup><col style="width:23.2%"><col style="width:21.1%"><col style="width:25.3%"><col style="width:30.5%"></colgroup>
<tbody>
<tr>
<td style="background-color:#1F3864;color:#FFFFFF;text-align:center;vertical-align:middle"><strong>Нозологія</strong></td>
<td style="background-color:#1F3864;color:#FFFFFF;text-align:center;vertical-align:middle"><strong>Зміна DFA-α1</strong></td>
<td style="background-color:#1F3864;color:#FFFFFF;text-align:center;vertical-align:middle"><strong>Клінічне значення</strong></td>
<td style="background-color:#1F3864;color:#FFFFFF;text-align:center;vertical-align:middle"><strong>Рівень доказовості</strong></td>
</tr>
<tr>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">Здоровий стан (спокій)</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">~1,0–1,2</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">Норма фрактальної регуляції</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">—</td>
</tr>
<tr>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">Хронічна серцева недостатність</td>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">Знижений (&lt; 0,9)</td>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">Предиктор смертності</td>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">Рівень B (когортні дослідж.)</td>
</tr>
<tr>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">Раптова серцева смерть</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">Знижений (&lt; норми)</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">Незалежний предиктор (HR 2,4)</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">Рівень B (FINCAVAS, 2024)</td>
</tr>
<tr>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">Гострий інфаркт міокарда</td>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">Знижений або підвищений*</td>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">Предиктор ускладнень</td>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">Рівень B (пілотні досл.)</td>
</tr>
<tr>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">Термінальна ниркова недостатність</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">Знижений (&lt; 0,95)</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">AUC 0,76 для смертності</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">Рівень B (когортне досл.)</td>
</tr>
<tr>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">Постопераційна ФП (АКШ)</td>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">Знижений (доопер.)</td>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">AUC 0,725; специфічність 80%</td>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">Рівень B (проспект. досл.)</td>
</tr>
<tr>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">Цукровий діабет / ДКН</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">Знижений</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">Маркер автономної нейропатії</td>
<td style="background-color:#EEF2F7;color:#000000;vertical-align:middle">Рівень B (крос-секц. досл.)</td>
</tr>
<tr>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">Загальна/спинальна анестезія</td>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">Знижений (двофазн.)</td>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">Моніторинг автономії під час операції</td>
<td style="background-color:#FFFFFF;color:#000000;vertical-align:middle">Рівень C (невелика серія)</td>
</tr>
</tbody>
</table>

<div align="center">

<span style="font-size:10pt">*Таблиця 4. Клінічне значення DFA-α1 при різних патологічних станах (\* підвищення при гострому стресі)*</span>

</div>

# **6\. Методологічні обмеження та перспективи**

## **6.1. Обмеження методу**

-   <span style="font-size:12pt">Тривалість запису: для надійного обчислення DFA-α1 необхідна достатня кількість серцевих скорочень. При коротких записах (< 256 RR-інтервалів) достовірність знижується.</span>
-   <span style="font-size:12pt">Артефакти руху: фізична активність генерує рухові артефакти в записах ЧСС, що може значно спотворювати DFA-α1. Ця проблема особливо актуальна для носимих пристроїв.</span>
-   <span style="font-size:12pt">Ектопічні скорочення та аритмії: фібриляція передсердь або часті екстрасистоли роблять обчислення DFA-α1 некоректним або неінтерпретабельним.</span>
-   <span style="font-size:12pt">Вплив фармакотерапії: бета-блокатори, антиаритміки, холінолітики суттєво впливають на DFA-α1, що необхідно враховувати при інтерпретації.</span>
-   <span style="font-size:12pt">Відсутність стандартизованих порогових значень: попри численні дослідження, єдині консенсусні порогові значення DFA-α1 для клінічного застосування поки не розроблені.</span>
-   <span style="font-size:12pt">Стать та кардіореспіраторна форма: дослідження показали, що стать і рівень тренованості значно впливають на узгодженість порогів DFA-α1 з фізіологічними порогами (Cassirame et al., 2025).</span>

## **6.2. Технічні вдосконалення**

<span style="font-size:12pt">Останні роки принесли важливі методологічні удосконалення DFA. Hernesniemi et al. (2024) показали, що використання вікон, що перекриваються, та поліномів вищого порядку для детрендування (DFA2 замість DFA1), а також застосування фільтру Калмана для оцінки показника, суттєво підвищують предиктивну цінність методу.</span>

<span style="font-size:12pt">Концепція "динамічного DFA" (dynamic DFA) та обчислення α(s) як похідної логарифмічної флуктуаційної функції дозволяють отримати неперервний профіль фрактальних властивостей, а не лише усереднений показник для фіксованого діапазону масштабів.</span>

## **6.3. Клінічні перспективи**

<span style="font-size:12pt">Завдяки розвитку носимих пристроїв (розумні годинники, кільця-трекери з фотоплетизмографією та ЕКГ-реєстрацією) стає можливим безперервний багатодобовий моніторинг DFA-α1 у амбулаторних умовах. Це відкриває перспективи для динамічної стратифікації кардіоваскулярного ризику та ранньої діагностики автономної дисфункції.</span>

<span style="font-size:12pt">В галузі кардіореабілітації DFA-α1 набуває значення як об'єктивний маркер для дозування фізичних навантажень без необхідності проведення максимальних навантажувальних тестів, що особливо цінно для пацієнтів з серцево-судинними захворюваннями.</span>

# **7\. Висновки**

<span style="font-size:12pt">DFA-α1 є перспективним нелінійним показником варіабельності серцевого ритму, що відображає фрактальні кореляційні властивості кардіоінтервалограми та стан вегетативної регуляції серця. На відміну від традиційних лінійних показників ВСР, DFA-α1 здатний виявляти субтонкі порушення автономної регуляції навіть за відносно збережених стандартних параметрів.</span>

<span style="font-size:12pt">Ключові клінічні позиції:</span>

-   <span style="font-size:12pt">У здорових осіб у спокої DFA-α1 ≈ 1,0–1,2, що відповідає оптимальним фрактальним ("рожевий шум") кореляціям серцевого ритму.</span>
-   <span style="font-size:12pt">Зниження DFA-α1 є маркером погіршення вегетативної регуляції та асоціюється з підвищеним кардіоваскулярним ризиком при серцевій недостатності, після ІМ, при нирковій патології та при автономній нейропатії.</span>
-   <span style="font-size:12pt">Нова модифікація DFA2 α1 (дослідження FINCAVAS, 2024) є потужним незалежним предиктором раптової серцевої смерті, перевершуючи традиційні показники ВСР за предиктивною цінністю.</span>
-   <span style="font-size:12pt">Пороговий рівень DFA-α1 < 0,95 при термінальній нирковій недостатності пов'язаний з AUC 0,761 для прогнозування смертності.</span>
-   <span style="font-size:12pt">Метод потребує подальшої стандартизації протоколів та порогових значень для широкого клінічного застосування.</span>

# **8\. Ключові літературні джерела**

<span style="font-size:12pt">1\. Peng CK, Havlin S, Stanley HE, Goldberger AL. Quantification of scaling exponents and crossover phenomena in nonstationary heartbeat time series. Chaos. 1995;5(1):82-87.</span>

<span style="font-size:12pt">2\. Pikkujämsä SM, Mäkikallio TH, Sourander LB, et al. Cardiac interbeat interval dynamics from childhood to senescence: comparison of conventional and new measures based on fractals and chaos theory. Circulation. 1999;100(4):393-399.</span>

<span style="font-size:12pt">3\. Echeverría JC, Woolfson MS, Crowe JA, et al. Interpretation of heart rate variability via detrended fluctuation analysis and αβ filter. Chaos. 2003;13(2):467-475. arXiv:physics/0306181</span>

<span style="font-size:12pt">4\. Gronwald T, Rogers B, Hoos O. Correlation properties of heart rate variability during endurance exercise: A systematic review. Ann Noninvasive Electrocardiol. 2020;25(1):e12697. PMC7358842.</span>

<span style="font-size:12pt">5\. Rogers B, Giles D, Draper N, Plews D, Laursen P. A New Detection Method Defining the Aerobic Threshold for Endurance Exercise and Field Test Application. Int J Environ Res Public Health. 2021;18(3):1229. PMC7830868.</span>

<span style="font-size:12pt">6\. Lin YH, Ho WY, Liao SR, et al. Usefulness of heart rhythm complexity in heart failure detection and diagnosis. Sci Rep. 2020;10(1):14916. PMC7483411.</span>

<span style="font-size:12pt">7\. Liu MH, Wang CH, Huang CY, et al. Detrended fluctuation analysis can detect the impairment of heart rate regulation in patients with HFpEF. J Cardiol. 2021;77(3):310-317.</span>

<span style="font-size:12pt">8\. Chen SC, Chang JM, Hwang SJ, et al. DFA of HRV is an important prognostic factor in ESRD patients receiving peritoneal dialysis. PLoS One. 2016;11(1):e0147282. PMC4734614.</span>

<span style="font-size:12pt">9\. Takahashi N, Kiyono H, Hayano J, et al. Increased Non-Gaussianity of HRV Predicts Cardiac Mortality after Acute Myocardial Infarction. Front Physiol. 2013;3:65. PMC3183481.</span>

<span style="font-size:12pt">10\. Hernesniemi JA, Tulppo MP, Anttila M, et al. Prediction of Sudden Cardiac Death With Ultra-Short-Term Heart Rate Fluctuations. JACC Clin Electrophysiol. 2024;10(9):2048-2059. DOI:10.1016/j.jacep.2024.04.018.</span>

<span style="font-size:12pt">11\. Kaplan O, Aktaş A, Kınay AO. Predictive Value of Heart Rate Variability for Postoperative Atrial Fibrillation in Off-Pump Coronary Artery Bypass Patients. J Cardiovasc Dev Dis. 2025;12(6):234. PMC12195077.</span>

<span style="font-size:12pt">12\. Omote K, Tada H, Ohsaki H, et al. Fractal Properties of Heart Rate Dynamics: A New Biomarker for Anesthesia. Front Physiol. 2022;13:987804. PMC9740393.</span>

<span style="font-size:12pt">13\. Cassirame J, Tordi N, Mourot L, et al. Detrended fluctuation analysis to determine physiologic thresholds. Eur J Appl Physiol. 2025;125:523–533.</span>

<span style="font-size:12pt">14\. Task Force of the European Society of Cardiology and the North American Society of Pacing and Electrophysiology. Heart rate variability: standards of measurement, physiological interpretation, and clinical use. Circulation. 1996;93(5):1043-1065.</span>

<div align="center">

<span style="font-size:9pt">*Документ підготовлено на основі аналізу наукової літератури | Травень 2026*</span>

</div>
